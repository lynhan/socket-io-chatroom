
// chatserver.js
// main chat server js code


// make app server
// handle http request at 7000
var express = require('express');
var app = express();
var server = app.listen(7000);
var io = require('socket.io').listen(server);

console.log("server and socket both listening on 7000");

// routing
// static file in resources (public)
app.use('/static', express.static(__dirname +'/resources'));

// default page is index.html
app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});




// user model
var User = function(username, socket){
    this.username = username;
    this.socket = socket;
};

// room model
var Room = function(roomname, owner, password)  {
    this.roomname = roomname;
    this.owner = owner;
    this.password = password;
    this.conversation = [];
    this.chats = []; // chat objects

    this.users = []; // actually just usernames
    this.temp_ban = {};
    this.perm_ban = [];
};

var users = {}; // username: user
var rooms = {"room1":new Room("room1", "server", "")};

function getRoomKey() { // array of room names from rooms dict
    return Object.keys(rooms).map(function(key) {
        return key;
    });
}

function getRoomValue(){ // array of room objects from rooms dict
    return Object.keys(rooms).map(function(key) {
        return rooms[key];
    });
}

var Chat = function(name1, name2, socket1, socket2) {
    this.conversation = [];
    this.name1 = name1;
    this.name2 = name2;
};





// on connection respond to events
io.sockets.on("connection", function(socket)    {

    // add new user to room 1
    socket.on("add_user", function(username){
        socket.username = username;
        socket.roomname = 'room1';
        socket.join('room1'); // join room 1 channel

        users[username] = new User(username, socket); // add user to dict
        var message = "server:   " + username + " joined room1 <br>";
        rooms["room1"].conversation.push(message); // add message to room convo
        rooms["room1"].users.push(username); // add user to users in room

        io.sockets.emit('update_conversation', rooms["room1"].conversation);
        io.sockets.emit('update_rooms', getRoomValue());
        io.sockets.in(socket.roomname).emit('update_users', rooms["room1"].users);

        console.log("users in room1 " + rooms["room1"].users);
        socket.emit('update_current_room', "room1");
        socket.emit('update_current_user', username);
    });

    // add line to room convo
    socket.on('send_conversation', function (string) {
        var message = socket.username + ":   " + string + "<br>";
        rooms[socket.roomname].conversation.push(message); // add message to room convo
        // update all connections in room
        io.sockets.in(socket.roomname).emit('update_conversation', rooms[socket.roomname].conversation);
    });

    // update user disconnet
    socket.on('disconnect', function(){
        console.log("user disconnected");

        delete users[socket.username]; // remove user
        var index = rooms[socket.roomname].users.indexOf(socket.username);
        rooms[socket.roomname].users.splice(index, 1); // remove user from users in room

        var message = "server:   " + socket.username + " disconnected <br>";
        rooms[socket.roomname].conversation.push(message); // add message to room convo

        io.sockets.emit('update_conversation', rooms[socket.roomname].conversation);
        io.sockets.emit('update_conversation', message);
        io.sockets.in(socket.roomname).emit('update_users', rooms[socket.roomname].users);
        socket.leave(socket.roomname);
    });

    // make room
    socket.on('create_room', function(roomname, password){
        rooms[roomname] = new Room(roomname, socket.username, password);
        // update everyone's room list
        io.sockets.emit('update_rooms', getRoomValue());
    });

    // switch room initial ask
    socket.on('switch_room', function(newroom){

        var room = rooms[newroom];

        // check if perm ban
        if (room.perm_ban.indexOf(socket.username) > -1) {
            message = "you're permanently banned from that room!";
            socket.emit('status', message);
        }

        // check if temp ban
        else if (socket.username in room.temp_ban) {
            var ban_start_time = room.temp_ban[socket.username];
            var current_time = new Date().getSeconds();
            var diff = current_time - ban_start_time;

            console.log("ban start time: " + ban_start_time);
            console.log("current_time " + current_time);
            console.log("diff " + diff);

            if (diff < 20) {
                message = "you're temporarily banned from that room!";
                socket.emit('status', message);
            }
            else { // ok to ask for pw
                delete room.temp_ban[socket.username];

                if (room.password !== "") {
                    socket.emit('ask_pw', newroom, room.password);
                }
                else {
                    switch_to_room(newroom);
                }
            }
        }

        else { // not banned anywhere
            if (room.password !== "") {
                socket.emit('ask_pw', newroom, room.password);
            }
            else {
                switch_to_room(newroom);
            }
        }
    });

    // switch room right pw
    socket.on('switch_okay', function(newroom){
        switch_to_room(newroom);
    });

    // actually switch
    function switch_to_room(newroom) {

        // delete all chats containing user in old room
        old_chats = rooms[socket.roomname].chats;

        for (var i=0; i<old_chats.length; i++) {
            if (old_chats[i].name1 == socket.username || old_chats[i].name2 == socket.username) {
                rooms[socket.roomname].chats.splice(i, 1);
            }
        }

        socket.leave(socket.roomname);

        // remove user from users in old room
        var index = rooms[socket.roomname].users.indexOf(socket.username);
        rooms[socket.roomname].users.splice(index, 1); // remove user from users in room
        io.sockets.in(socket.roomname).emit('update_users', rooms[socket.roomname].users);

        socket.join(newroom);
        socket.roomname = newroom;
        rooms[newroom].users.push(socket.username);
        io.sockets.in(socket.roomname).emit('update_users', rooms[newroom].users);

        io.sockets.emit('update_rooms', getRoomValue());
        socket.emit('update_current_room', newroom);
        socket.emit('update_conversation', rooms[newroom].conversation);
    }

    // start chat
    socket.on('start_chat', function(otherName) {

        otherSocket = users[otherName].socket;
        var chat = new Chat(socket.username, otherName, socket, otherSocket);
        var message = "begin chat, " + socket.username + " and " + otherName + "! <br>";

        chat.conversation.push(message); // add message to chat
        rooms[socket.roomname].chats.push(chat); // add chat to room

        socket.emit('update_chat', chat.conversation, otherName);
        console.log("other socket id: " + otherSocket.id);
        socket.broadcast.to(otherSocket.id).emit('update_chat', chat.conversation, socket.username);

    });

    // add line to room convo
    socket.on('send_chat', function (string, otherName) {
        console.log("in send chat");
        var message = socket.username + ":   " + string + "<br>";

        //find chat
        chats = rooms[socket.roomname].chats;
        var chat;
        var foundChat = false;

        for (var i = 0; i<chats.length; i++) {
            if (chats[i].name1 == socket.username && chats[i].name2 == otherName) {
                console.log("found chat");
                foundChat = true;
                chat = chats[i];
                break;
            }
            else if (chats[i].name2 == socket.username && chats[i].name1 == otherName)  {
                console.log("found chat else");
                foundChat = true;
                chat = chats[i];
                break;
            }
        }

        if (foundChat) {
            var otherSocketID = users[otherName].socket.id;
            console.log("other socket id: " + otherSocketID);

            chat.conversation.push(message);    // add message to chat
            socket.emit('update_chat', chat.conversation, otherName);
            socket.broadcast.to(otherSocketID).emit('update_chat', chat.conversation, socket.username);
        }
        else {
            message = "you're not chatting with anyone yet";
            socket.emit('status', message);
        }
    });

socket.on('perm_ban', function(myname, username) {
        // check owner
        if (myname == rooms[socket.roomname].owner) {
            // add username to perm ban list
            rooms[socket.roomname].perm_ban.push(username);
            message = "user permanently banned";
            socket.emit('status', message);
        }
        else {
            message = "you don't own this room";
            socket.emit('status', message);
        }
    });

socket.on('temp_ban', function(myname, username) {
         // check owner
         if (myname == rooms[socket.roomname].owner) {

            // ban for 20 seconds
            var ban_start_time = new Date().getSeconds();

            // add username to temp ban list
            rooms[socket.roomname].temp_ban[username] = ban_start_time;
            message = "user temporarily banned";
            socket.emit('status', message);
        }
        else {
            message = "you don't own this room";
            socket.emit('status', message);
        }
    });

socket.on('delete_room', function() {
    console.log("in delete room");

    if (socket.roomname in rooms) {

         // check owner
         if (socket.username == rooms[socket.roomname].owner) {
            console.log("deleting room");

            var room_to_delete = socket.roomname;
            switch_to_room("room1");
            // remove room from rooms list
            delete rooms[room_to_delete];
            message = "room deleted";
            socket.emit('status', message);
            io.sockets.emit('update_rooms', getRoomValue());
        }
        else {
            console.log("oop");
            message = "you don't own this room";
            socket.emit('status', message);
        }
    }

    else {
        message = "room not found";
        socket.emit('status', message);
    }
});

});
