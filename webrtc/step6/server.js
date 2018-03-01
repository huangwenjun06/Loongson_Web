var static = require('node-static');
var http = require('http');
var file = new(static.Server)();
var app = http.createServer(function (req, res) {
    file.serve(req, res);
}).listen(2013);

var io = require('socket.io').listen(app);
io.sockets.on('connection', function (socket){

    //var address = socket.handshake.address;
    //console.log("new connection from " + address.address + ":" + address.port);

    function log(){
        var array = [">>> Message from server: "];
        for (var i = 0; i < arguments.length; i++) {
            array.push(arguments[i]);
        }
        socket.emit('log', array);
    }

    socket.on('message', function (message) {
        //if (message.sdp)
        //{
        //    //sdp:
        //    // ...
        //    //o=Mozilla-SIPUA-35.0 12619 0 IN IP4 0.0.0.0
        //    // ...
        //    //c=IN IP4 0.0.0.0
        //    //a=rtcp:1 IN IP4 0.0.0.0
        //    // ...
        //    //
        //    
        //    // assign client ip address
        //    var sdpLines = message.sdp.split('\r\n');
        //    for (var i = 0; i < sdpLines.length; i++)
        //    {
        //        if (sdpLines[i].search(/^(c|a)=.*IN IP4 \d+\.\d+\.\d+\.\d+/) !== -1)
        //        {
        //            var clientIp = address.address;
        //            if (clientIp === '0.0.0.0' || clientIp === '127.0.0.1')
        //            {
        //                clientIp = '172.16.72.143';
        //            }
        //            sdpLines[i] =
        //                sdpLines[i].replace(/IP4 \d+\.\d+\.\d+\.\d+/, clientIp);
        //        }
        //    }
        //    message.sdp = sdpLines.join('\r\n');
        //}
        log('Got message: ', message);
        // For a real app, should be room only (not broadcast)
        socket.broadcast.emit('message', message);
    });

    socket.on('create or join', function (room) {
        var numClients = io.sockets.clients(room).length;

        log('Room ' + room + ' has ' + numClients + ' client(s)');
        log('Request to create or join room', room);

        if (numClients == 0){
            socket.join(room);
            socket.emit('created', room);
        } else if (numClients == 1) {
            io.sockets.in(room).emit('join', room);
            socket.join(room);
            socket.emit('joined', room);
        } else { // max two clients
            socket.emit('full', room);
        }
        socket.emit('emit(): client ' + socket.id + ' joined room ' + room);
        socket.broadcast.emit('broadcast(): client ' + socket.id + ' joined room ' + room);

    });

});

