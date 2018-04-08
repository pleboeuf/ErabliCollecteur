FROM node:6
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app
COPY . /usr/src/app
RUN npm install
VOLUME ["/data"]
EXPOSE 8150
CMD [ "node", "app"]

