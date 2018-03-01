'use strict';

var isChannelReady;
var isInitiator = false;
var isStarted = false;
var localStream;
var pc;
var remoteStream;
var turnReady;

// stun server: stun.iptel.org
var pc_config = {iceServers: [{url: 'stun:stun.l.google.com:19302'}]};
//var pc_config = {iceServers: [
//    {url: 'stun:stun.l.google.com:19302'},
//    {url:'turn:172.16.72.143',username:'webrtc-user',credential:'password'}]};
//var pc_config = {iceServers: [
//    {url: 'stun:172.16.72.143'},
//    {url: 'stun:stun.voipbuster.com'},
//    {url: 'stun:stun.wirlab.net'},
//    {url: 'stun:stun.voxgratia.org'},
//    {url: 'stun:stun.iptel.org'},
//    {url: 'stun:stun.ideasip.com'},
//    {url: 'stun:stun.schlund.de'},
//    {url: 'stun:stun.ekiga.net'},
//    {url: 'stun:stun.3cx.com'},
//    {url: 'stun:numb.viagenie.ca'}
//    ]};

var pc_constraints = {'optional': [{'DtlsSrtpKeyAgreement': true}]};

// Set up audio and video regardless of what devices are present.
var sdpConstraints = {'mandatory': {
    'OfferToReceiveAudio':true,
    'OfferToReceiveVideo':true }};

/////////////////////////////////////////////

var room = location.pathname.substring(1);
if (room === '') {
    //  room = prompt('Enter room name:');
    room = 'foo';
} else {
    //
}

var socket = io.connect();

if (room !== '') {
    console.log('Create or join room', room);
    socket.emit('create or join', room);
}

socket.on('created', function (room){
    console.log('Created room ' + room);
    isInitiator = true;
});

socket.on('full', function (room){
    console.log('Room ' + room + ' is full');
});

socket.on('join', function (room){
    console.log('Another peer made a request to join room ' + room);
    console.log('This peer is the initiator of room ' + room + '!');
    isChannelReady = true;
});

socket.on('joined', function (room){
    console.log('This peer has joined room ' + room);
    isChannelReady = true;
});

socket.on('log', function (array){
    console.log.apply(console, array);
});

////////////////////////////////////////////////

function sendMessage(message){
    console.log('Client sending message: ', message);
    // if (typeof message === 'object') {
    //   message = JSON.stringify(message);
    // }
    socket.emit('message', message);
}

socket.on('message', function (message){
    console.log('Client received message:', message);
    if (message === 'got user media') {
        maybeStart();
    } else if (message.type === 'offer') {
        if (!isInitiator && !isStarted) {
            maybeStart();
        }
        pc.setRemoteDescription(new RTCSessionDescription(message));
        doAnswer();
    } else if (message.type === 'answer' && isStarted) {
        pc.setRemoteDescription(new RTCSessionDescription(message));
    } else if (message.type === 'candidate' && isStarted) {
        var candidate = new RTCIceCandidate({
            sdpMLineIndex: message.label,
            candidate: message.candidate
        });
        pc.addIceCandidate(candidate);
    } else if (message === 'bye' && isStarted) {
        handleRemoteHangup();
    }
});

////////////////////////////////////////////////////

var localVideo = document.querySelector('#localVideo');
var remoteVideo = document.querySelector('#remoteVideo');

function handleUserMedia(stream) {
    console.log('Adding local stream.');
    localVideo.src = window.URL.createObjectURL(stream);
    localStream = stream;
    sendMessage('got user media');
    if (isInitiator) {
        maybeStart();
    }
}

var localInfo = {
    name: 'local',
    video: document.querySelector('#localVideo'),
    text: document.querySelector('#localInfo'),
    current: {w:0, h:0, f:0, t:0, fps:0},
    best: {},
    hist: []
};
var remoteInfo = {
    name: 'remote',
    video: document.querySelector('#remoteVideo'),
    text: document.querySelector('#remoteInfo'),
    current: {w:0, h:0, f:0, t:0, fps:0},
    best: {},
    hist: []
};
function reportInfo(info)
{
    var text = '';
    var stat = {w:0, h:0, f:0, t:0, fps:0};

    // dimentions
    stat.w = info.video.videoWidth;
    stat.h = info.video.videoHeight;

    if (stat.w == 0) {
        info.text.innerHTML = '';
        info.best = {};
        info.hist = [];
        return;
    }

    text = info.name + ": " + stat.w + "x" + stat.h;
    // framerate
    if (navigator.userAgent.search("Firefox") >= 0) {
        stat.f = info.video.mozPaintedFrames;
    } else if (navigator.userAgent.search("Chrome") >= 0) {
        stat.f = info.video.webkitDecodedFrameCount
            + info.video.webkitDroppedFrameCount;
    } else {
        stat.f = 0;
    }
    //stat.t = info.video.currentTime;
    stat.t = Math.floor(Date.now()/1000);

    // current fps
    if (info.hist.length > 0 && stat.t > info.hist[info.hist.length-1].t) {
        stat.fps = stat.f - info.hist[info.hist.length-1].f;
        text += ' - ' + stat.fps + ' fps';
    }
    info.current = stat;
    info.hist.push(stat);

    // average reports
    // long history of N-seconds
    var N = 100;
    var hist = info.hist.slice(-N);
    info.hist = hist;
    var begin = info.hist[0];
    var avgfps = 0;
    if (stat.t > begin.t) {
        avgfps = Math.floor((stat.f - begin.f) / (stat.t - begin.t));
    }

    // history statistics, for n-seconds moving-average.
    var n = 5;
    hist = info.hist.slice(-n);
    for (var i=0; i<n && i < hist.length; ++i) {
        if (hist[hist.length-1-i].w == stat.w) {
            begin = hist[hist.length-1-i];
        }
    }
    if (stat.t >= begin.t + n - 1) {
        stat.fps = Math.floor((stat.f - begin.f) / (stat.t - begin.t));
    }

    // best reports
    //     Only calculate best after connection established. And the best hold
    // by info is a mapped lists of descendent ordered items indexed by video
    // size. Items oldder than history will be erased from lists.  Items those
    // sharing the same fps only the last one is reserved as a proxy. After new
    // item inserted, resort the list to keep best the fist one.
    if (remoteInfo.current.t > 0) {
        var size = stat.w * stat.h;
        var best = info.best[size];
        if (best === undefined) {
            info.best[size] = best = [];
            best.push(stat);
        } else {
            var start = info.hist[0].t;
            var needsSort = true;
            for (var i in best) {
                if (best[i].t < start) {
                    best.splice(i, 1);
                } else if (best[i].fps == stat.fps) {
                    best[i] = stat;
                    needsSort = false;
                    break;
                }
            }
            if (needsSort) {
                best.push(stat);
                best.sort(function(a,b){return b.fps - a.fps;});
            }
        }
        if (best[0].fps > 0) {
            text += '<br>best: ' + best[0].w + 'x' + best[0].h
                  + ' - ' + best[0].fps + " fps";
        }
    }

    if (avgfps > 0) {
        text += '<br>stable: ' + avgfps + ' fps';
    }

    info.text.innerHTML = text;
}

function report()
{
    reportInfo(localInfo);
    reportInfo(remoteInfo);
    setTimeout(function(){report();},1000);
}

localVideo.addEventListener('play', function(){
    setTimeout(function(){report();}, 500);});
//setTimeout(function(){report();}, 500);

function handleUserMediaError(error){
    console.log('getUserMedia error: ', error);
}

var callButton = document.querySelector('#callButton');
callButton.onclick = call;
function call() {
    var radios = document.getElementsByName('dim');
    var width = 640;
    var height = 480;
    for(var i=0; i<radios.length; ++i) {
        if(radios[i].checked) {
            var match = radios[i].value.match(/(\d+)x(\d+)/);
            if (match.length == 3) {
                width = match[1];
                height = match[2];
            }
            console.log("checked dimensions: " + radios[i].value);
        }
        radios[i].disabled = true;
    }
    console.log('preferer dimensions: ' + width + 'x' + height);
    callButton.style.visibility = 'hidden';
    var constraints;
    if (navigator.userAgent.search("Firefox") >= 0) {
        constraints = { audio: {}, video: {} };
        if (width < 640) {
            constraints.video =  { 
                width: {min: 320, ideal: width, max: width},
                height: {min: 240, ideal: height, max: width}};
        } else {
            constraints.video =  { 
                width: {min: width, ideal: width, max: 1920},
                height: {min: height, ideal: height, max: 1080}};
        }
    } else if (navigator.userAgent.search("Chrome") >= 0) {
        constraints = { audio: { optional: [
            {sampleRate: 4000},
                {echoCancellation: true}
            ] } };
        if (width < 640) {
            constraints.video = { optional: [
                {maxWidth: width},
                    {maxHeight: height},
                    {minFrameRate: 30}
                ] };
        } else {
            constraints.video = { optional: [
                {minWidth: width},
                    {minHeight: height},
                    {minFrameRate: 30}
                ] };
        }
    } else {
        console.log('User Agent \"' + navigator.userAgent + '\" is not supported now.');
        return;
    }
    getUserMedia(constraints, handleUserMedia, handleUserMediaError);
    console.log('Getting user media with constraints', constraints);
    if (location.hostname != "localhost") {
        requestTurn('https://computeengineondemand.appspot.com/turn?username=41784574&key=4080218913');
    }
}

function maybeStart() {
    if (!isStarted && typeof localStream != 'undefined' && isChannelReady) {
        createPeerConnection();
        pc.addStream(localStream);
        isStarted = true;
        console.log('isInitiator', isInitiator);
        if (isInitiator) {
            doCall();
        }
    }
}

window.onbeforeunload = function(e){
    sendMessage('bye');
}

/////////////////////////////////////////////////////////

function createPeerConnection() {
    try {
        //pc = new RTCPeerConnection(pc_constraints);
        pc = new RTCPeerConnection(null);
        pc.onicecandidate = handleIceCandidate;
        pc.onaddstream = handleRemoteStreamAdded;
        pc.onremovestream = handleRemoteStreamRemoved;
        console.log('Created RTCPeerConnnection');
    } catch (e) {
        console.log('Failed to create PeerConnection, exception: ' + e.message);
        alert('Cannot create RTCPeerConnection object.');
        return;
    }
}

function handleIceCandidate(event) {
    console.log('handleIceCandidate event: ', event);
    if (event.candidate) {
        sendMessage({
            type: 'candidate',
            label: event.candidate.sdpMLineIndex,
            id: event.candidate.sdpMid,
            candidate: event.candidate.candidate});
    } else {
        console.log('End of candidates.');
    }
}

function handleRemoteStreamAdded(event) {
    console.log('Remote stream added.');
    remoteVideo.src = window.URL.createObjectURL(event.stream);
    remoteStream = event.stream;
}

function handleCreateOfferError(event){
    console.log('createOffer() error: ', event);
}

function handleCreateAnswerError(event){
    console.log('createOffer() error: ', event);
}

function doCall() {
    console.log('Sending offer to peer');
    pc.createOffer(setLocalAndSendMessage, handleCreateOfferError);
}

function doAnswer() {
    console.log('Sending answer to peer.');
    //pc.createAnswer(setLocalAndSendMessage, null, sdpConstraints);
    pc.createAnswer(setLocalAndSendMessage, handleCreateAnswerError,
            sdpConstraints);
}

function setLocalAndSendMessage(desc) {
    desc.sdp = filterSdp(desc.sdp);
    // Set Opus as the preferred codec in SDP if Opus is present.
    desc.sdp = preferOpus(desc.sdp);
    pc.setLocalDescription(desc);
    console.log('setLocalAndSendMessage sending message' , desc);
    sendMessage(desc);
}

function requestTurn(turn_url) {
    var turnExists = false;
    for (var i in pc_config.iceServers) {
        if (pc_config.iceServers[i].url.substr(0, 5) === 'turn:') {
            turnExists = true;
            turnReady = true;
            break;
        }
    }
    if (!turnExists) {
        console.log('Getting TURN server from ', turn_url);
        // No TURN server. Get one from computeengineondemand.appspot.com:
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function(){
            if (xhr.readyState === 4 && xhr.status === 200) {
                var turnServer = JSON.parse(xhr.responseText);
                console.log('Got TURN server: ', turnServer);
                pc_config.iceServers.push({
                    'url': 'turn:' + turnServer.username + '@' + turnServer.turn,
                    'credential': turnServer.password
                });
                turnReady = true;
            }
        };
        xhr.open('GET', turn_url, true);
        xhr.send();
    }
}

function handleRemoteStreamAdded(event) {
    console.log('Remote stream added.');
    remoteVideo.src = window.URL.createObjectURL(event.stream);
    remoteStream = event.stream;
}

function handleRemoteStreamRemoved(event) {
    console.log('Remote stream removed. Event: ', event);
}

function hangup() {
    console.log('Hanging up.');
    stop();
    sendMessage('bye');
}

function handleRemoteHangup() {
    //  console.log('Session terminated.');
    // stop();
    // isInitiator = false;
}

function stop() {
    isStarted = false;
    // isAudioMuted = false;
    // isVideoMuted = false;
    pc.close();
    pc = null;
}

///////////////////////////////////////////

// Set Opus as the default audio codec if it's present.
function preferOpus(sdp) {
    var sdpLines = sdp.split('\r\n');
    var mLineIndex;
    // Search for m line.
    for (var i = 0; i < sdpLines.length; i++) {
        if (sdpLines[i].search('m=audio') !== -1) {
            mLineIndex = i;
            break;
        }
    }
    if (mLineIndex === undefined) {
        return sdp;
    }

    // If Opus is available, set it as the default in m line.
    for (i = 0; i < sdpLines.length; i++) {
        if (sdpLines[i].search('opus/48000') !== -1) {
            var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
            if (opusPayload) {
                sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], opusPayload);
            }
            break;
        }
    }

    // Remove CN in m line and sdp.
    sdpLines = removeCN(sdpLines, mLineIndex);

    sdp = sdpLines.join('\r\n');
    return sdp;
}

function extractSdp(sdpLine, pattern) {
    var result = sdpLine.match(pattern);
    return result && result.length === 2 ? result[1] : null;
}

// Set the selected codec to the first in m line.
function setDefaultCodec(mLine, payload) {
    var elements = mLine.split(' ');
    var newLine = [];
    var index = 0;
    for (var i = 0; i < elements.length; i++) {
        if (index === 3) { // Format of media starts from the fourth.
            newLine[index++] = payload; // Put target payload to the first.
        }
        if (elements[i] !== payload) {
            newLine[index++] = elements[i];
        }
    }
    return newLine.join(' ');
}

// Strip CN from sdp before CN constraints is ready.
function removeCN(sdpLines, mLineIndex) {
    var mLineElements = sdpLines[mLineIndex].split(' ');
    // Scan from end for the convenience of removing an item.
    for (var i = sdpLines.length-1; i >= 0; i--) {
        var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
        if (payload) {
            var cnPos = mLineElements.indexOf(payload);
            if (cnPos !== -1) {
                // Remove CN payload from m line.
                mLineElements.splice(cnPos, 1);
            }
            // Remove CN line in sdp
            sdpLines.splice(i, 1);
        }
    }

    sdpLines[mLineIndex] = mLineElements.join(' ');
    return sdpLines;
}

//////////////////////////////
// 
// by xiezhigang:
//

function filterSdp(sdp) {
//    var tsdp = tsdp_message.prototype.Parse(sdp);
    //ensureRTP(tsdp);
    //videoFilter(tsdp);
//    return tsdp.toString();
	return sdp;
}

function ensureRTP(tsdp) {
    for (var i in tsdp.ao_headers) {
        if (tsdp.ao_headers[i].e_type == tsdp_header_type_e.M) {
            var tsdp_m = tsdp.ao_headers[i];
            tsdp_m.s_proto = "RTP/AVP";
            for (var j = 0; j < tsdp_m.ao_hdr_A.length; ++j) {
                // remove 'a=crypto'
                if (tsdp_m.ao_hdr_A[j].s_field === 'crypto') {
                    tsdp_m.ao_hdr_A.splice(j, 1);
                    Console.log('removed a=crypto from ' + tsdp_m.media);
                    break;
                }
            }
        }
    }
}

function videoFilter(tsdp) {
    var tsdp_v = tsdp.get_header_m_by_name('video');
    if (tsdp_v !== undefined) {
        for (var i = 0; i < tsdp_v.ao_hdr_A.length; ++i) {
            var a = tsdp_v.ao_hdr_A[i];

            // remove all except reserved
            //var reserved = [' VP8/', ' rtx/'];
            var reserved = [' H264/'];
            if (a.s_field === 'rtpmap') {
                var is_reserved = false;
                for (var item in reserved) {
                    if (a.s_value.search(reserved[item]) !== -1) {
                        is_reserved = true;
                        break;
                    }
                }
                if (!is_reserved) {
                    var pt = a.s_value.split(' ')[0];
                    for (var j = 0; j < tsdp_v.as_fmt.length; ++j) {
                        if (tsdp_v.as_fmt[j] === pt) {
                            tsdp_v.as_fmt.splice(j, 1);
                            break;
                        }
                    }
                    tsdp_v.ao_hdr_A.splice(i--, 1);
                }
            }
        }
    }
}
