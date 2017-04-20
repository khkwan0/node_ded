FROM node:alpine

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY package.json /usr/src/app
COPY index.js /usr/src/app
COPY config.js /usr/src/app
COPY assets /usr/src/app/assets
COPY views /usr/src/app/views
COPY lib /usr/src/app/lib
RUN npm install

CMD ["npm", "start"]
