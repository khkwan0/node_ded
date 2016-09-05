var express = require('express');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var cons = require('consolidate');
var passport = require('passport'),
    FacebookStrategy = require('passport-facebook').Strategy,
    LocalStrategy = require('passport-local').Strategy;
var app = express();
var RedisStore = require('connect-redis')(session);
var bodyParser = require('body-parser');
var redis = require('redis');
var flash = require('connect-flash');
var fs = require('fs');
var striptags = require('striptags');
var config = require('./config');

redis_client = redis.createClient();
redis_client.select(2);

app.use(cookieParser());
app.use(session({
                store: new RedisStore({
                    host: 'localhost',
                    port: 6379,
                    db: 2
                }),
                resave: false,
                saveUninitialized: false,
                secret: config.session.secret}));
app.use(bodyParser.json());       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
              extended: true
              }));
app.use(flash());
passport.use(new FacebookStrategy({
            clientID: config.facebook.clientID,
            clientSecret: config.facebook.clientSecret,
            callbackURL: 'http://caldrivers.com:8080/auth/facebook/callback',
            profileFields: ['id', 'photos', 'emails']
        },
        function (successToken, refreshToken, profile, done) {
            email = profile.emails[0].value;
            redis_client.get(email, function(err, data) {
                if (err) {
                    return done(err);
                }
                if (data) {
                    user = JSON.parse(data);
                    if (typeof user.profile === 'undefined') {
                        user.profile = {};
                    }
                    if (typeof user.profile.fb === 'undefined') {
                        user.profile.fb = profile;
                    }
                    redis_client.set(email, JSON.stringify(user), function(err) {
                        if (err) {
                            throw(err);
                        }
                        done(null, user);
                    });
                } else { 
                    var new_user = {
                        'email': email,
                        'datetime': Date.now() ,
                        'profile': {fb:profile}
                    }
                    redis_client.set(email, JSON.stringify(new_user), function(err) {
                        if (err) {
                            throw(err);
                        }
                        return done(null, new_user);
                    });
                }
            });
        }
));
passport.use('local-register', new LocalStrategy({
                usernameField : 'email',
                passwordField : 'password',
                passReqToCallback : true
            }, function(req, email, password, done) {
                process.nextTick(function() {
                    redis_client.get(email, function(err, user) {
                        if (err) {
                            done(err);
                        }
                        if (user) {
                            return done(null, false, req.flash('signupMessage', 'That email already exists.'));
                        } else {
                            var new_user = {
                                email: email,
                                password: password,
                                datetime: Date.now(),
                                profile: {
                                    local: {}
                                }
                            }
                            redis_client.set(email, JSON.stringify(new_user));
                            return done(null, new_user);
                        }
                    });
                });
            }));

passport.use('local-login', new LocalStrategy({
    // by default, local strategy uses username and password, we will override with email
    usernameField : 'email',
    passwordField : 'password',
    passReqToCallback : true // allows us to pass back the entire request to the callback
}, function(req, email, password, done) {
    redis_client.get(email, function(err, data) {
        if (err) {
            return done(err);
        }
        if (!data) {
            return done(null, false, req.flash('loginMessage', 'No user found'));
        } else {
            user = JSON.parse(data);
            if (password != user.password) {
                return done(null, false, req.flash('loginMessage', 'Oops! Wrong password'));
            }
            return done(null, user);
        }
    });
}));
            
passport.serializeUser(function(user, done) {
    done(null, user);
});
 
passport.deserializeUser(function(id, done) {
/*
  User.findById(id, function(err, user) {
    done(err, user);
  });
*/
        done(null, id);
});

app.engine('html',  cons.swig);
app.set('view engine', 'swig');
app.set('views', __dirname + '/views');

app.use('/assets', express.static('assets'));
app.use(passport.initialize());
app.use(passport.session());

app.get('/', function(req, res) {
    res.render('index.html',null);
});
app.get('/about', function(req, res) {
    res.render('about.html');
});
app.get('/disclaimer', function(req, res) {
    res.render('disclaimer.html');
});
app.get('/contact', function(req, res) {
    res.render('contact.html');
});

app.get('/login', function(req, res) {
    if (req.user) {
        res.redirect('/status');
    } else {
        res.render('login.html');
    }
});

app.get('/logout', function(req, res) {
    req.session.destroy(function(err) {
        if (err) {
        } else {
            res.redirect('/login');
        }
    });
});

app.post('/register', passport.authenticate('local-register', {
    successRedirect: '/status',
    failureRedirect: '/login',
    failureFlash: true
}));

app.get('/status', function(req, res) {
    if (req.user) {
        res.render('status.html', {'email':req.user.email});
    } else {
        res.redirect('login');
    }
});

app.get('/auth/facebook', passport.authenticate('facebook', {scope: 'email'}));
app.post('/auth/local', passport.authenticate('local-login',
            {
                successRedirect: '/status',
                failureRedirect: '/login',
                failureFlash: true
            }));

app.get('/auth/facebook/callback', passport.authenticate('facebook', {
    successRedirect: '/status',
    failureRedirect: '/login'
}));

app.get('/lesson/:unit', function(req, res) {
    if (req.user) {
        unit = req.params.unit;
        issues = {};
        redis_client.get('unit'+unit, function(err, data) {
            if (err) {
                res.render('status.html', {'email':req.user.email});
            } else if (!data) {
                fs.readFile('lib/unit'+unit+'.js', 'utf8', function(err, data)  {
                    if (err) {
                        res.render('status.html', {'email':req.user.email});
                    } else {
                        issues = JSON.parse(data);
                        for (i in issues) {
                            issues[i].lesson = striptags(issues[i].lesson, "<a><h1><h2><h3><video><source>");
                        }
                        if (unit == 11) {
                            to_quiz_slide = {
                                lesson: '<a href="/quiz/'+unit+'">Click to take the final exam</a>'
                            }
                        } else {
                            to_quiz_slide = {
                                lesson: '<a href="/quiz/'+unit+'">Click to take quiz for unit '+unit+'</a>'
                            }
                        }
                        issues.push(to_quiz_slide);
                        redis_client.set('unit'+unit, JSON.stringify(issues));
                        res.render('teach.html', {'issues':issues, 'email':req.user.email,'unit':unit});
                    }
                });
            } else {
                issues = JSON.parse(data);
                res.render('teach.html', {'issues':issues, 'email':req.user.email,'unit':unit});
            }
        });
    } else {
        res.redirect('/login');
    }
});

app.get('/quiz/:unit', function(req, res) {
    if (req.user) {
        unit = req.params.unit;
        next_unit = parseInt(parseFloat(unit)) + 1;
        if (unit == 11) {
            next_unit = 69;
            unit = 69;
        }
        redis_client.get('quiz'+unit, function(err, data) {
            if (err) {
                res.render('status.html', {'email':req.user.email});
            } else if (!data) {
                fs.readFile('lib/quiz'+unit+'.js', 'utf8', function(err, data) {
                    if (err) {
                        throw(err);
                    } else {
                        quiz = JSON.parse(data);
                        redis_client.set('quiz'+unit, data);
                        res.render('quiz.html', {'quiz':quiz,'email':req.user.email,'unit':unit,'next_unit':next_unit});
                    }
                });
            } else {
                quiz = JSON.parse(data);
                res.render('quiz.html', {'quiz':quiz,'email':req.user.email,'unit':unit,'next_unit':next_unit});
            }
        });
    } else {
        res.redirect('/login');
    }
});

app.post('/api/checkAnswers', function(req, res) {
    var answers = JSON.parse(req.body.answers);
    var unit = req.body.unit;
    quiz = [];
    redis_client.get('quiz'+unit, function(err, data) {
        if (err) {
            res.render('status.html', {'email':req.user.email});
        } else if (!data) {
            fs.readFile('lib/quiz'+unit+'.js', 'utf8', function(err, data) {
                if (err) {
                    throw(err);
                } else {
                    quiz = JSON.parse(data);
                    wrong = checkAnswers(answers, quiz);
                    res.send(JSON.stringify(wrong));
                    redis_client.set('quiz'+unit, data);
                }
            });
        } else {
            quiz = JSON.parse(data);
            wrong = checkAnswers(answers, quiz);
            res.send(JSON.stringify(wrong));
        }
    });
});

function checkAnswers(answers, quiz) {
    wrong = {};
    answers.forEach(function(answer, idx) {
        var correct = false;;
        tokens = answer.split(',',2);
        answer_id = tokens[1];
        question_id = tokens[0];
//        console.log('quest: '+question_id+' '+'answer: '+answer_id);
        quiz.forEach(function(question, qidx) {
            question.answers.forEach(function(qanswer, aidx) {
//                console.log('quiz_ans: '+qanswer.answer_id+' quiz_ques: '+question.question_id);
                if (qanswer.answer_id == answer_id && question.question_id == question_id && qanswer.correct == 1) {
                    correct = true;
                }
            });
        });
        if (!correct) {
            wrong[question_id] = 1;
        }
    });
    return wrong;
}

app.listen(8080, null);
