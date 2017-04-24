var express = require('express');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var cons = require('consolidate');
var passport = require('passport'),
    FacebookStrategy = require('passport-facebook').Strategy,
    GoogleStrategy = require('passport-google-oauth20').Strategy,
    TwitterStrategy = require('passport-twitter').Strategy,
    LocalStrategy = require('passport-local').Strategy,
    SteamStrategy = require('passport-steam').Strategy,
    WindowsLiveStrategy = require('passport-windowslive').Strategy,
    BattleNetStrategy = require('passport-bnet').Strategy,
    YahooStrategy = require('passport-yahoo').Strategy;

var app = express();
var RedisStore = require('connect-redis')(session);
var bodyParser = require('body-parser');
var redis = require('redis');
var flash = require('connect-flash');
var fs = require('fs');
var striptags = require('striptags');
var config = require('./config');
var https = require('https');
var uuid = require('uuid');
var parseString= require('xml2js').parseString;
var TwitterStream = require('twitter-stream-api');
var sendMail = require('sendmail')();
var async = require('async');
var moment = require('moment-timezone');

redis_client = redis.createClient(
        {
            'host': config.redis.host
        });
redis_client.select(2);
lib_client = redis.createClient(
        {
            'host': config.redis.host
        });
lib_client.select(3);
lib_client.flushdb();

tweet_store = redis.createClient(
        {
            'host': config.redis.host
        });
tweet_store.select(4);

user_list = redis.createClient(
        {
            'host': config.redis.host
        });
user_list.select(5);

var tweets = [];

tweet_store.get('ca_dmv_tweets', function(err, data) {
    if (err) {
        console.log('redis get ca_dmv_tweets error: ' + err);
    } else {
        try {
            if (typeof data !== 'undefined' && data != 'null') {
                tweets = JSON.parse(data);
            }
        } catch(e) {
            console.log(e);
        }
    }
});

app.use(cookieParser());
app.use(session({
        store: new RedisStore({
            host: config.redis.host,
            port: 6379,
            db: 2
        }),
        resave: false,
        saveUninitialized: false,
        secret: config.session.secret})
);
app.use(bodyParser.json());       // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({     // to support URL-encoded bodies
    extended: true
}));
app.use(flash());

var mailOptions = {
    from: 'info@caldrivers.com',
    to: 'ken@caldrivers.com',
    subject: 'Server start',
    html: '<h2>Server just started up</h2>'
};
sendmail(mailOptions);

// send mail
function sendmail(mailOptions) {
    sendMail(mailOptions, function(err, reply) {
        if (err) {
            console.log(err && err.stack);
        }
        console.log(reply);
    });
}

passport.use(new FacebookStrategy({
            clientID: config.facebook.clientID,
            clientSecret: config.facebook.clientSecret,
            callbackURL: 'https://caldrivers.com/auth/facebook/callback',
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
                    user.lastlogin = Date.now();
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
                        'profile': {fb:profile},
                        'admin': 0,
                        'lastlogin': Date.now()
                    }
                    mailOptions = {
                        from: 'info@caldrivers.com',
                        to: 'support@caldrivers.com',
                        subject: 'New user: '+ email,
                        html: '<div>Date: ' + new_user.datetime + '</div><br /><div><pre>' + new_user.profile + '</pre></div>'
                    }
                    sendmail(mailOptions);
                    addNewUser(email);
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

passport.use(new GoogleStrategy({
        clientID: config.google.clientID,
        clientSecret: config.google.clientSecret,
        callbackURL: "https://caldrivers.com/auth/google/callback"
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
                if (typeof user.profile.google === 'undefined') {
                    user.profile.google = profile;
                }
                user.lastlogin = Date.now();
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
                    'profile': {google:profile},
                    'admin': 0,
                    'lastlogin': Date.now()
                }
                mailOptions = {
                    from: 'info@caldrivers.com',
                    to: 'support@caldrivers.com',
                    subject: 'New user: '+ email,
                    html: '<div>Date: ' + new_user.datetime + '</div><br /><div><pre>' + new_user.profile + '</pre></div>'
                }
                sendmail(mailOptions);
                addNewUser(email);
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

passport.use(new TwitterStrategy({
        consumerKey: config.twitter.consumerKey,
        consumerSecret: config.twitter.consumerSecret,
        callbackURL: "https://caldrivers.com/auth/twitter/callback"
    },
    function (successToken, refreshToken, profile, done) {
        email = profile.displayName,
        redis_client.get(email, function(err, data) {
            if (err) {
                return done(err);
            }
            if (data) {
                user = JSON.parse(data);
                if (typeof user.profile === 'undefined') {
                    user.profile = {};
                }
                if (typeof user.profile.twitter === 'undefined') {
                    user.profile.twitter = profile;
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
                    'profile': {twitter:profile}
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

passport.use(new SteamStrategy({
    returnURL: 'https://caldrivers.com/auth/steam/callback',
    realm: 'https://caldrivers.com',
    apiKey: config.steam.steamKey
    },
    function(identifier, profile, done) {
        email = profile.displayName
        redis_client.get(email, function(err, data) {
            if (err) {
                return done(err);
            }
            if (data) {
                user = JSON.parse(data);
                if (typeof user.profile === 'undefined') {
                    user.profile = {};
                }
                if (typeof user.profile.twitter === 'undefined') {
                    user.profile.steam = profile;
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
                    'profile': {steam:profile}
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

passport.use(new WindowsLiveStrategy({
        clientID: config.windowslive.clientID,
        clientSecret: config.windowslive.password,
        callbackURL: "https://caldrivers.com/auth/windowslive/callback"
    },
    function(accessToken, refreshToken, profile, done) {
        email = profile.displayName
        redis_client.get(email, function(err, data) {
            if (err) {
                return done(err);
            }
            if (data) {
                user = JSON.parse(data);
                if (typeof user.profile === 'undefined') {
                    user.profile = {};
                }
                if (typeof user.profile.twitter === 'undefined') {
                    user.profile.windowslive= profile;
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
                    'profile': {windowslive:profile}
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

passport.use(new BattleNetStrategy({
        clientID: config.bnet.clientID,
        clientSecret: config.bnet.secret,
        callbackURL: "https://caldrivers.com/auth/bnet/callback",
        region: "us"
    },
    function(accessToken, refreshToken, profile, done) {
        email = profile.battletag;
        redis_client.get(email, function(err, data) {
            if (err) {
                return done(err);
            }
            if (data) {
                user = JSON.parse(data);
                if (typeof user.profile === 'undefined') {
                    user.profile = {};
                }
                if (typeof user.profile.twitter === 'undefined') {
                    user.profile.bnet= profile;
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
                    'profile': {bnet:profile}
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

passport.use(new YahooStrategy({
        returnURL: 'https://caldrivers.com/auth/yahoo/callback',
        realm: 'https://caldrivers.com'
    },
    function(identifier, profile, done) {
        console.log(profile);
        return done(null, profile);
    }));
    /*
        redis_client.get(guid, function(err, data) {
            if (err) {
                return done(err);
            }
            if (data) {
                user = JSON.parse(data);
                if (typeof user.profile === 'undefined') {
                    user.profile = {};
                }
                if (typeof user.profile.twitter === 'undefined') {
                    user.profile.guid = profile;
                }
                redis_client.set(guid, JSON.stringify(user), function(err) {
                    if (err) {
                        throw(err);
                    }
                    done(null, user);
                });
            } else { 
                var new_user = {
                    'guid': guid,
                    'datetime': Date.now() ,
                    'profile': {yahoo:profile}
                }
                redis_client.set(guid, JSON.stringify(new_user), function(err) {
                    if (err) {
                        throw(err);
                    }
                    return done(null, new_user);
                });
            }
        });
    }
));
        */

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
                                },
                                admin: 0,
                                lastlogin: Date.now()

                            }
                            mailOptions = {
                                from: 'info@caldrivers.com',
                                to: 'support@caldrivers.com',
                                subject: 'New user: '+ email,
                                html: '<div>Date: ' + new_user.datetime + '</div><br /><div><pre>' + new_user.profile + '</pre></div>'
                            }
                            sendmail(mailOptions);
                            addNewUser(email);
                            redis_client.set(email, JSON.stringify(new_user));
                            return done(null, new_user);
                        }
                    });
                });
            })
);

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
            user.lastlogin = Date.now();
            redis_client.set(email, JSON.stringify(user));
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

app.engine('html',  cons.nunjucks);
app.set('view engine', 'html');
app.set('views', __dirname + '/views');

app.use('/assets', express.static('assets'));
app.use(passport.initialize());
app.use(passport.session());

app.get('/', function(req, res) {
    if (typeof req.user !== 'undefined' && typeof req.user.email !== 'undefined') {
        res.render('index.html',{'tweets':tweets, 'email': req.user.email});
    } else {
        res.render('index.html',{'tweets':tweets});
    }
});
app.get('/about', function(req, res) {
    if (typeof req.user !== 'undefined' && typeof req.user.email !== 'undefined') {
        res.render('about.html', {'email':req.user.email});
    } else {
        res.render('about.html');
    }
});
app.get('/disclaimer', function(req, res) {
    if (typeof req.user !== 'undefined' && typeof req.user.email !== 'undefined') {
        res.render('disclaimer.html', {'email': req.user.email});
    } else {
        res.render('disclaimer.html');
    }
});
app.get('/contact', function(req, res) {
    if (typeof req.user !== 'undefined' && typeof req.user.email !== 'undefined') {
        res.render('contact.html', { 'email': req.user.email });
    } else {
        res.render('contact.html');
    }
});

app.get('/login', function(req, res) {
    if (req.user) {
        res.redirect('/status');
    } else {
        res.render('login.html');
    }
});

app.get('/register', function(req, res) {
    res.render('register.html');
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
        if (req.user.admin) {
            res.render('status.html', {'email':req.user.email, 'state':req.user.reveal_state, 'admin': 1});
        } else {
            res.render('status.html', {'email':req.user.email, 'state':req.user.reveal_state});
        }
    } else {
        res.redirect('login');
    }
});

app.get('/signs', function(req, res) {
    if (req.user) {
        res.render('signs.html', {'email':req.user.email});
    } else {
        res.redirect('/login');
    }
});

app.get('/overview', function(req, res) {
    if (req.user) {
        res.render('overview.html', {'email': req.user.email});
    } else {
        res.redirect('/login');
    }
});

app.get('/auth/facebook', passport.authenticate('facebook', {scope: 'email'}));
app.get('/auth/google', passport.authenticate('google', {scope: 'email'}));
app.get('/auth/twitter', passport.authenticate('twitter', {scope: 'email'}));
app.get('/auth/steam', passport.authenticate('steam', {scope: 'email'}));
app.get('/auth/windowslive', passport.authenticate('windowslive', {scope: ['wl.signin', 'wl.basic']}));
app.get('/auth/bnet', passport.authenticate('bnet'));
app.get('/auth/yahoo', passport.authenticate('yahoo'));
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

app.get('/auth/google/callback', passport.authenticate('google', {
    successRedirect: '/status',
    failureRedirect: '/login'
}));

app.get('/auth/twitter/callback', passport.authenticate('twitter', {
    successRedirect: '/status',
    failureRedirect: '/login'
}));

app.get('/auth/steam/callback', passport.authenticate('steam', {
    successRedirect: '/status',
    failureRedirect: '/login'
}));

app.get('/auth/windowslive/callback', passport.authenticate('windowslive', {
    successRedirect: '/status',
    failureRedirect: '/login'
}));

app.get('/auth/bnet/callback', passport.authenticate('bnet', {
    successRedirect: '/status',
    failureRedirect: '/login'
}));

app.get('/auth/yahoo/callback', passport.authenticate('yahoo', {
    successRedirect: '/status',
    failureRedirect: '/login'
}));

app.get('/lesson/:unit', function(req, res) {
    if (req.user) {
        unit = req.params.unit;
        issues = {};
        lib_client.get('unit'+unit, function(err, data) {
            if (err) {
                res.render('status.html', {'email':req.user.email});
            } else if (!data) {
                fs.readFile('lib/unit'+unit+'.js', 'utf8', function(err, data)  {
                    if (err) {
                        res.render('status.html', {'email':req.user.email});
                    } else {
                        issues = JSON.parse(data);
                        for (i in issues) {
                            issues[i].lesson = striptags(issues[i].lesson, "<a><h1><h2><h3><video><source><img>");
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
                        lib_client.set('unit'+unit, JSON.stringify(issues));
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
        try {
            lib_client.get('quiz'+unit, function(err, data) {
                if (err) {
                    res.render('status.html', {'email':req.user.email});
                } else if (!data) {
                    fs.readFile('lib/quiz'+unit+'.js', 'utf8', function(err, data) {
                        if (err) {
                            console.log(err);
                            res.redirect('/status');
                        } else {
                            quiz = JSON.parse(data);
                            lib_client.set('quiz'+unit, data);
                            res.render('quiz.html', {'quiz':quiz,'email':req.user.email,'unit':unit,'next_unit':next_unit});
                        }
                    });
                } else {
                    quiz = JSON.parse(data);
                    res.render('quiz.html', {'quiz':quiz,'email':req.user.email,'unit':unit,'next_unit':next_unit});
                }
            });
        } catch(e) {
            console.log(e);
            res.status(404).send('404');;
        }
    } else {
        res.redirect('/login');
    }
});

app.post('/save_state', function(req, res) {
    try {
        req.user.reveal_state = req.body.state;
        redis_client.set(req.user.email, JSON.stringify(req.user));
        res.send('ok');
    } catch(e) {
        console.log(e);
    }
});

app.post('/getuser', function(req, res) {
    if (req.user.admin == 1) {
        try {
            redis_client.get(req.body.email, function(err, data) {
                if (err) ress.send(err);
                res.send(data);
            });
        } catch(e) {
            res.send(e);
        }
    }
});

app.post('/setadmin', function(req, res) {
    if (req.user.admin == 1) {
        redis_client.get(req.body.email, function(err, data) {
            if (err) res.send(err);
            try {
                user = JSON.parse(data);
                if (req.body.admin == 'true') {
                    user.admin = 1;
                    console.log(user.email + ' is now an admin');
                    res.send(user.email + ' is now an admin');
                } else {
                    user.admin = 0;
                    console.log(user.email + ' removed from admin');
                    res.send(user.email + ' removed from admin');
                }
                redis_client.set(req.body.email, JSON.stringify(user));
            } catch(e) {
                console.log(e);
                res.send(e);
            }
        });
    } else {
        res.sendStatus(404);
    }
});

app.post('/api/checkAnswers', function(req, res) {
    var answers = JSON.parse(req.body.answers);
    var unit = req.body.unit;
    quiz = [];
    redis_client.get('quiz'+unit, function(err, data) {
        if (err) {
            res.status(404).send('404');
        } else if (!data) {
            fs.readFile('lib/quiz'+unit+'.js', 'utf8', function(err, data) {
                if (err) {
                    res.status(404).send('404');
                } else {
                    quiz = JSON.parse(data);
                    wrong = checkAnswers(answers, quiz);
                    console.log('check anbswer'+wrong.length + unit);
                    if (wrong.length === 0 && unit == 69) {
                        passFinal(req, answers);
                    }
                    res.send(JSON.stringify(wrong));
                    redis_client.set('quiz'+unit, data);
                }
            });
        } else {
            quiz = JSON.parse(data);
            wrong = checkAnswers(answers, quiz);
            console.log('check answers'+wrong.length + unit);
            if (wrong.length === 0 && unit == 69) {
                passFinal(req, answers);
            }
            res.send(JSON.stringify(wrong));
        }
    });
});

app.get('/congrats', function(req, res) {
    if (typeof req.user !=='undefined' && typeof req.user.pass_final !== 'undefined' && req.user.pass_final) {
        res.render('congrats.html', {'email':req.user.email});
    } else {
        res.status(404).send('404');
    }
});

app.get('/setpass',function(req, res) {
    if (req.user.email === 'khkwan0@gmail.com') {
        req.user.pass_final = 1;
        redis_client.set(req.user.email, JSON.stringify(req.user));
        res.status(200).send();
    }
});

app.post('/save_shipping', function(req, res) {
    try {
        rv = {};
        req.user.shipping = JSON.parse(req.body.shipping);
        if (typeof req.user.shipping.addy2 === 'undefined') {
            req.user.shipping.addy2 = '';
        }
        redis_client.set(req.user.email, JSON.stringify(req.user), function(err) {
            if (err) {
                console.log(err);
                rv.err = 'Problem saving info.  Please contact support@caldrivers.com';
            } else {
                rv.valid = 1;
            }
            res.send(JSON.stringify(rv));
        });
    } catch(e) {
        console.log(e);
        rv.err = 'Problem saving info.  Please contact support@caldrivers.com';
        res.send(JSON.stringify(rv));
    }
});

app.get('/billing', function(req, res) {
    if (typeof req.user !== 'undefined' && typeof req.user.purchase !== 'undefined' && req.user.email!='khkwan0@gmail.com') {
        res.render('congrats.html', {'email':req.user.email});
    } else if (typeof req.user !== 'undefined' && req.user.pass_final!=='undefined' && req.user.pass_final) {
        shipping = req.user.shipping;
        res.render('billing.html', {'email':req.user.email,'shipping':shipping});
    } else {
        res.status(404).send('404');
    }
});

app.post('/save_billing', function(req, res) {
    try {
        rv = {};
        req.user.billing = JSON.parse(req.body.billing);
        if (typeof req.user.billing.addy2 === 'undefined') {
            req.user.billing.addy2 = '';
        }
        redis_client.set(req.user.email, JSON.stringify(req.user), function(err) {
            if (err) {
                rv.err = 'Problem saving info.  Please contact support@caldrivers.com';
            } else {
                rv.valid = 1;
                req.user.cc = JSON.parse(req.body.cc);
                req.user.cc.last_four = req.user.cc.cc_no.substr(req.user.cc.cc_no.length -4);
            }
            res.send(JSON.stringify(rv));
        });
    } catch(e) {
        console.log(e);
        rv.err = 'Problem saving info.  Please contact support@caldrivers.com';
        res.send(JSON.stringify(rv));
    }
});

app.get('/final_verify', function(req, res) {
    if (typeof req.user !== 'undefined' && typeof req.user.purchase !== 'undefined' && req.user.email !== 'khkwan0@gmail.com') {
        res.render('congrats.html',{'email':req.user.email});
    }
    if (typeof req.user !== 'undefined' && req.user.pass_final && req.user.billing && req.user.shipping && req.user.cc) {
        res.render('final_verify.html', { 'email':req.user.email,'shipping':req.user.shipping,'billing':req.user.billing,'cc':req.user.cc});
    } else {
        res.status(404).send('Not found');
    }
});

app.get('/admin', function(req, res) {
    if (typeof req.user !== 'undefined' && req.user.admin == 1) {
        user_list.get('users', function(err, data) {
            if (err) console.log(err);
            if (data) {
                users = JSON.parse(data);
            } else {
                users = [];
            }
            var user_data = [];
            async.each(users,
                function(user, callback) {
                    redis_client.get(user, function(err, data) {
                        if (data) {
                            user = JSON.parse(data);
                            user.datetime = moment(user.datetime).tz('America/los_angeles').format('YYYY-MM-DD HH:mm')
                            if (typeof user.lastlogin !== 'undefined') {
                                user.lastlogin = moment(user.lastlogin).tz('America/los_angeles').format('YYYY-MM-DD HH:mm')
                            } else {
                                user.lastlogin = 'n/a';
                            }
                            user_data.push(user);
                        }
                        callback();
                    });
                },
                function(err) {
                    if (err) {
                        console.log(err)
                    } else {
                        console.log(user_data);
                        res.render('admin.html', {'user_data': user_data,'email':req.user.email});
                    }
                }
            );
        });
    } else {
        res.sendStatus(404);
    }
});

app.post('/do_purchase', function(req, reso) {
    if ((req.user.pass_final && req.user.billing && req.user.shipping && req.user.cc && req.user.purchase === 'undefined') || req.user.email === 'khkwan0@gmail.com') {
        var base_price = 45.00;
        var shipping_cost = 4.99;
        if (req.user.billing.expedite) {
            shipping_cost= 19.95
        }
        total_amount = base_price + shipping_cost;
        names = req.user.billing.name.split(' ',2);
        first_name = names[0];
        last_name = names[1];
        refid = 1;
        ship_names = req.user.shipping.name.split(' ', 2);
        sfirst_name = ship_names[0];
        slast_name = ship_names[1];
        inv_number = new Date().getTime();
        ref_id = uuid.v4();
        var post_data = '<createTransactionRequest xmlns="AnetApi/xml/v1/schema/AnetApiSchema.xsd">';
        post_data += '<merchantAuthentication> <name>'+config.gateway.name+'</name> <transactionKey>'+config.gateway.transactionKey+'</transactionKey> </merchantAuthentication>';
        post_data += '<refId>'+refid+'</refId>';
        post_data += '<transactionRequest> <transactionType>authCaptureTransaction</transactionType> <amount>'+total_amount+'</amount> <payment> <creditCard> <cardNumber>'+req.user.cc.cc_no+'</cardNumber> <expirationDate>'+req.user.cc.month+req.user.cc.year+'</expirationDate> <cardCode>'+req.user.cc.csc+'</cardCode> </creditCard> </payment> <order> <invoiceNumber>INV-'+inv_number+'</invoiceNumber> <description>DMV Certificate</description> </order> <lineItems> <lineItem> <itemId>1</itemId> <name>DMV Cert</name> <description>DMV Certificate</description> <quantity>1</quantity> <unitPrice>'+base_price+'</unitPrice> </lineItem> </lineItems> <tax> <amount>0.00</amount> <name>level2 tax name</name> <description></description> </tax> <duty> <amount>0.00</amount> <name>duty name</name> <description>duty description</description> </duty> <shipping> <amount>'+shipping_cost+'</amount> <name></name> <description></description> </shipping> <poNumber></poNumber> <customer> <id>'+req.user.email+'</id> <email>'+req.user.email+'</email></customer> <billTo> <firstName>'+first_name+'</firstName> <lastName>'+last_name+'</lastName> <company></company> <address>'+req.user.billing.addy1+req.user.billing.add2+'</address> <city>'+req.user.billing.city+'</city> <state>'+req.user.billing.state+'</state> <zip>'+req.user.billing.zip+'</zip> <country>USA</country> </billTo> <shipTo> <firstName>'+sfirst_name+'</firstName> <lastName>'+slast_name+'</lastName> <company></company> <address>'+req.user.shipping.addy1+req.user.shipping.addy2+'</address> <city>'+req.user.shipping.city+'</city> <state>'+req.user.shipping.state+'</state> <zip>'+req.user.shipping.zip+'</zip> <country>USA</country> </shipTo> <customerIP>'+req.connection.remoteAddress+'</customerIP> <!-- Uncomment this section for Card Present Sandbox Accounts --> <!-- <retail><marketType>2</marketType><deviceType>1</deviceType></retail> --> <transactionSettings> <setting> <settingName>testRequest</settingName> <settingValue>false</settingValue> </setting> </transactionSettings> <userFields> <userField> <name>Diversified Brands Intl. Inc.</name> <value></value> </userField> <userField> <name></name> <value></value> </userField> </userFields> </transactionRequest> </createTransactionRequest>';
//        console.log(post_data);
        post_options = {
            host: 'api.authorize.net',
            port: '443',
            path: '/xml/v1/request.api',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content_Length': post_data.length
            }
        };

        var post_req = https.request(post_options, function(res) {
            rv = {};
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                try {
                    parseString(chunk, function (err, result) {
                        if (err) {
                            console.log('unable to parse response from authorize');
                            rv.error = 'invalid response from Credit Card gateway.  No transaction has been recorded';
                            console.log('Response: '+chunk);
                        } else {
                            if (typeof result['createTransactionResponse'] !== 'undefined') {
                                transaction_response = result['createTransactionResponse']['transactionResponse'][0];
                                if (typeof transaction_response !== 'undefined') {
                                    if (typeof transaction_response['responseCode'][0] !== 'undefined') {
                                        if (transaction_response['responseCode'][0] == 1) {
                                            req.user.purchase = transaction_response;  
                                            rv.valid = 1;
                                            redis_client.set(req.user.email, JSON.stringify(req.user));
                                        } else {
                                            rv.error = transaction_response['errors'][0]['error'][0]['errorText'][0];
                                            console.log(rv.error);
                                            console.log('Response: '+chunk);
                                        }
                                    } else {
                                        rv.error = 'Problem communicating with Credit Card gateway.  The management team at caldrivers.com has been informed.  We will update you shortly.';
                                        console.log('Response: '+chunk);
                                    }
                                } else {
                                    rv.error = 'Problem communicating with Credit Card gateway.  The management team at caldrivers.com has been informed.  We will update you shortly.';
                                    console.log('Response: '+chunk);
                                }
                            } else if (typeof result['ErrorResponse'] !== 'undefined') {
                                rv.error = result['ErrorResponse']['messages'][0]['message'][0]['text'][0];
                                console.log('Response: '+chunk);
                            } else {
                                rv.error = 'Problem communicating with Credit Card gateway.  The management team at caldrivers.com has been informed.  We will update you shortly.';
                                console.log('Response: '+chunk);
                            }
                        }
                        reso.send(JSON.stringify(rv));
                    });
                } catch(e) {
                    console.log('Response: '+chunk);
                    console.log(e);
                    rv.error = 'Problem communicating with Credit Card gateway.  The management team at caldrivers.com has been informed.  We will update you shortly.';
                    reso.send(JSON.stringify(rv));
                }
            });
        });
        post_req.write(post_data);
        post_req.end();
    } else {
        rv = {};
        rv.error = 'No shipping? No Billing?  Didn\'t finish? Already purchased?';
        reso.send(JSON.stringify(rv));
    }
});

app.get('/receipt', function(req, res) {
    if (typeof req.user.purchase !== 'undefined') {
        mailOptions = {
            from : 'info@caldrivers.com',
            to: 'support@caldrivers.com',
            subject: 'Purchase Complete! ' + req.user.email,
            html: '<div>Send certificate to:</div><br /><div>' + req.user.shipping + '</div><div>Expedite: ' + req.user.billing.expedite + '</div>'
        }
        sendmail(mailOptions);
        var cc = {};
        cc.auth_code = req.user.purchase['authCode'][0];
        cc.message = req.user.purchase['messages'][0]['message'][0]['description'][0];
        cc.type = req.user.purchase['accountType'][0];
        cc.account = req.user.purchase['accountNumber'][0];
        res.render('receipt.html', { 'email': req.user.email,'billing':req.user.billing,'shipping':req.user.shipping,'cc':cc });
    } else {
        res.status(404);
    }
});

var twitter_keys = {
    consumer_key: config.twitter.consumerKey,
    consumer_secret: config.twitter.consumerSecret,
    token: config.twitter.accessToken,
    token_secret: config.twitter.accessSecret
};

var Twitter = new TwitterStream(twitter_keys, false);
Twitter.stream('statuses/filter', {
    follow: config.twitter.ca_dmv_id
});

Twitter.on('data', function(buf) {
    tweet = JSON.parse(buf.toString());
    console.log('data' + new Date().getTime());
    if (tweet.user.id_str === config.twitter.ca_dmv_id && !tweet.in_reply_to_user_id) {
        d = new Date(parseInt(tweet.timestamp_ms));
        tweet_info = {
            time: d.toLocaleDateString() + ' ' + d.toLocaleTimeString(),
            text: tweet.text
        }
        console.log(tweet_info);
        try {
            console.log('tweets: ' + JSON.stringify(tweets));
            tweets.unshift(tweet_info);
        } catch(e) {
            console.log(e);
        }
        tweet_store.set('ca_dmv_tweets', JSON.stringify(tweets), function(err) {
            if (err) {
                console.log(err);
            }
        });
    }
});

Twitter.on('connection success', function(uri) {
    console.log('connection success', uri);
});
Twitter.on('connection error stall', function () {
    console.log('connection error stall');
});
Twitter.on('connection error network', function(error) {
    console.log('connection error network',error);
});
Twitter.on('connection error http', function (httpStatusCode) {
    console.log('connection error http', httpStatusCode);
});
Twitter.on('connection rate limit', function (httpStatusCode) {
    console.log('connection rate limit', httpStatusCode);
});
Twitter.on('connection error unknown', function (error) {
    console.log('connection error unknown', error);
    Twitter.close();
});
Twitter.on('data error', function (error) {
    console.log('data error', error);
});
Twitter.on('data keep-alive', function () {
//    console.log('data keep-alive');
});
/*
twitter_client.stream('statuses/filter', {follow:config.twitter.ca_dmv_id}, function(stream) {
    stream.on('data', function(tweet) {
        console.log(tweet);
        if (tweet.user.id_str === config.twitter.ca_dmv_id && !tweet.in_reply_to_user_id) {
            d = new Date(parseInt(tweet.timestamp_ms));
            tweet_info = {
                time: d.toLocaleDateString() + ' ' + d.toLocaleTimeString(),
                text: tweet.text
            }
            tweets.unshift(tweet_info);
            redis_client.set('ca_dmv_tweets', JSON.stringify(tweets), function(err) {
                if (err) {
                    console.log(err);
                }
            });
        }
    });
    stream.on('error', function(error) {
        console.log('ERROR: '+error);
    });
});
*/

function checkAnswers(answers, quiz) {
    var wrong = [];
    answers.forEach(function(answer, idx) {
        var correct = false;;
        tokens = answer.split(',',2);
        answer_id = tokens[1];
        question_id = tokens[0];
        console.log('quest: '+question_id+' '+'answer: '+answer_id);
        quiz.forEach(function(question, qidx) {
            question.answers.forEach(function(qanswer, aidx) {
                if (qanswer.answer_id == answer_id && question.question_id == question_id && qanswer.correct == 1) {
                console.log('quiz_ans: '+qanswer.answer_id+' quiz_ques: '+question.question_id);
                    correct = true;
                }
            });
        });
        if (!correct) {
           console.log(question_id + ' ' + answer_id);
            wrong.push(question_id);
            console.log(wrong);
        }
    });
            console.log(wrong);
    return wrong;
}

function passFinal(req, answers) {
    req.user.pass_final = 1;
    req.user.final = answers;
    console.log('pass final '+req.user);
    redis_client.set(req.user.email, JSON.stringify(req.user));
}

function addNewUser(email) {
    user_list.get('users', function(err, data) {
        if (err) {
            global_list = [];
        } else {
            console.log(data);
            if (!data) {
                console.log('data is null');
                global_list = [];
            } else {
                global_list = JSON.parse(data);
            }
            global_list.push(email);
        }
        user_list.set('users', JSON.stringify(global_list), function(err) {
            if (err) {
                console.log(err);
                mailOptions = {
                    from: 'info@caldrivers.com',
                    to: 'ken@caldrivers.com',
                    subject: 'Add New user err (redis set): '+ err,
                    html: '<div>Date: ' + Date.now() + '</div><br /><div><pre>Redis Set Error (add new user)</pre></div><div>'+err+'</div>'
                }
                sendmail(mailOptions);
            }
        });
    });
}

app.listen(8080, null);
