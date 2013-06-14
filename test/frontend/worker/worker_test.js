/* global afterEach, beforeEach, chai, describe,
   handlers, it, sinon, Port, PortCollection, _config:true,
   _presenceSocket:true, loadconfig, ports:true,
   _presenceSocketOnMessage, _presenceSocketOnError,
   _presenceSocketOnClose, _presenceSocketSendMessage:true,
   _presenceSocketOnOpen, _signinCallback, currentUsers:true,
   browserPort:true, _currentUserData:true, UserData,
   currentCall:true, serverHandlers, tryPresenceSocket,
   _presenceSocketReAttached, _loginExpired, _setupWebSocket,
   _ */
/* jshint expr:true */
/* Needed due to the use of non-camelcase in the websocket topics */
/* jshint camelcase:false */
var expect = chai.expect;

describe('Worker', function() {
  "use strict";
  var sandbox;

  beforeEach(function () {
    sandbox = sinon.sandbox.create();
    browserPort = {postEvent: sandbox.spy()};
  });

  afterEach(function () {
    browserPort = null;
    sandbox.restore();
  });

  describe("#loadconfig", function() {
    var oldConfig, xhr, requests;

    beforeEach(function() {
      oldConfig = _.clone(_config);
      // XXX For some reason, sandbox.useFakeXMLHttpRequest doesn't want to work
      // nicely so we have to manually xhr.restore for now.
      xhr = sinon.useFakeXMLHttpRequest();
      _config = {};
      requests = [];
      xhr.onCreate = function (req) { requests.push(req); };
    });

    afterEach(function() {
      _config = oldConfig;
      xhr.restore();
    });

    it("should populate the _config object from using AJAX load",
      function(done) {
        expect(_config).to.deep.equal({});
        loadconfig(function(err, config) {
          expect(requests).to.have.length.of(1);
          expect(requests[0].url).to.equal('/config.json');
          expect(config).to.deep.equal({WSURL: 'ws://fake', DEBUG: true});
          done();
        });
        requests[0].respond(200, {
          'Content-Type': 'application/json'
        }, '{"WSURL": "ws://fake", "DEBUG": true}');
      });
  });

  describe('Handlers', function() {
    it("should remove a closed port from the current collection", function() {
      ports = new PortCollection();
      var port = new Port({_portid: 42});
      ports.add(port);
      handlers['social.port-closing'].bind(port)();
      expect(Object.keys(ports.ports)).to.have.length.of(0);
    });
  });

  describe("#_signinCallback", function() {
    var socketStub, wsurl = 'ws://fake', testableCallback;

    beforeEach(function() {
      sandbox.stub(window, "WebSocket");
      socketStub = sinon.stub(window, "createPresenceSocket");
      _config.WSURL = wsurl;
      _currentUserData = new UserData({});
      sandbox.stub(_currentUserData, "send");
      testableCallback = _signinCallback.bind({postEvent: function(){}});
    });

    afterEach(function() {
      _currentUserData = undefined;
      socketStub.restore();
    });

    it("should initiate the presence connection if signin succeded",
      function() {
        var nickname = "bill";
        testableCallback(null, JSON.stringify({nick: nickname}));
        sinon.assert.calledOnce(socketStub);
        sinon.assert.calledWithExactly(socketStub, nickname);
      });

    it("should not initiate the presence connection if signin failed",
      function() {
        var nickname;
        testableCallback(null, JSON.stringify({nick: nickname}));
        sinon.assert.notCalled(socketStub);
      });
  });

  describe("#login", function() {
    var xhr, rootURL, socketStub, requests;

    beforeEach(function() {
      socketStub = sinon.stub(window, "createPresenceSocket");
      // XXX For some reason, sandbox.useFakeXMLHttpRequest doesn't want to work
      // nicely so we have to manually xhr.restore for now.
      xhr = sinon.useFakeXMLHttpRequest();
      requests = [];
      xhr.onCreate = function (req) { requests.push(req); };

      rootURL = 'http://fake';
      _currentUserData = new UserData({}, {
        ROOTURL: rootURL
      });
      sandbox.stub(_currentUserData, "send");
    });

    afterEach(function() {
      _currentUserData = undefined;
      xhr.restore();
      socketStub.restore();
    });

    it("should call postEvent with a failure message if I pass in bad data",
      function() {
        handlers.postEvent = sandbox.spy();
        handlers['talkilla.login']({topic: "talkilla.login", data: null});
        sinon.assert.calledOnce(handlers.postEvent);
        sinon.assert.calledWith(handlers.postEvent, "talkilla.login-failure");
      });

    it("should call postEvent with a pending message if I pass in valid data",
      function() {
        handlers.postEvent = sandbox.spy();
        handlers['talkilla.login']({
          topic: "talkilla.login",
          data: {username: "jb"}
        });
        sinon.assert.calledOnce(handlers.postEvent);
        sinon.assert.calledWith(handlers.postEvent, "talkilla.login-pending");
      });

    it("should post an ajax message to the server if I pass valid login data",
      function() {
        handlers['talkilla.login']({
          topic: "talkilla.login",
          data: {username: "jb"}
        });
        expect(requests.length).to.equal(1);
        expect(requests[0].url).to.equal('/signin');
        expect(requests[0].requestBody).to.be.not.empty;
        expect(requests[0].requestBody).to.be.equal('{"nick":"jb"}');
      });

    describe("Accepted Login", function() {
      var port;

      beforeEach(function() {
        port = {id: "tests", postEvent: sandbox.spy()};
        ports.add(port);

        handlers['talkilla.login']({
          topic: "talkilla.login",
          data: {username: "jb"}
        });
        expect(requests.length).to.equal(1);

        requests[0].respond(200, { 'Content-Type': 'application/json' },
          '{"nick":"jb"}' );
      });

      afterEach(function() {
        ports.remove(port);
      });

      it("should store the userName if the server accepted login", function() {
        expect(_currentUserData.userName).to.be.equal("jb");
      });

      it("should set the current user name if the server accepted login",
        function() {
          sinon.assert.calledOnce(_currentUserData.send);
        });

      it("should post a success message if the server accepted login",
        function() {
          sinon.assert.calledOnce(port.postEvent);
          sinon.assert.calledWith(port.postEvent, "talkilla.login-success");
          ports.remove(port);
        });

      it("should store the username if the server accepted login",
        function() {
          expect(_currentUserData.userName).to.equal('jb');
        });
    });

    it("should notify new sidebars of the logged in user",
      function() {
        _currentUserData.userName = "jb";
        handlers.postEvent = sinon.spy();
        handlers['talkilla.sidebar-ready']({
          topic: "talkilla.sidebar-ready",
          data: {}
        });

        sinon.assert.calledOnce(handlers.postEvent);
        sinon.assert.calledWith(handlers.postEvent, "talkilla.login-success");
      });

    it("should notify new sidebars of current users",
      function() {
        _currentUserData.userName = "jb";
        currentUsers = {};
        handlers.postEvent = sinon.spy();
        handlers['talkilla.sidebar-ready']({
          topic: "talkilla.sidebar-ready",
          data: {}
        });

        sinon.assert.calledWith(handlers.postEvent, "talkilla.users");
      });

    it("should notify new sidebars only if there's a logged in user",
      function() {
        handlers.postEvent = sinon.spy();
        handlers['talkilla.sidebar-ready']({
          topic: "talkilla.sidebar-ready",
          data: {}
        });

        sinon.assert.notCalled(handlers.postEvent);
      });

    it("should post a fail message if the server rejected login",
      function() {
        handlers.postEvent = sinon.spy();
        handlers['talkilla.login']({
          topic: "talkilla.login",
          data: {username: "jb"}
        });
        expect(requests.length).to.equal(1);

        requests[0].respond(401, { 'Content-Type': 'text/plain' },
                            'Not Authorised' );

        sinon.assert.calledTwice(handlers.postEvent);
        sinon.assert.calledWith(handlers.postEvent, "talkilla.login-failure");
      });
  });

  describe("#logout", function() {
    var xhr, requests;

    beforeEach(function() {
      // XXX For some reason, sandbox.useFakeXMLHttpRequest doesn't want to work
      // nicely so we have to manually xhr.restore for now.
      xhr = sinon.useFakeXMLHttpRequest();
      requests = [];
      xhr.onCreate = function (req) { requests.push(req); };

      _currentUserData = new UserData({userName: 'romain'}, {});
      _presenceSocket.close = sandbox.stub();
    });

    afterEach(function() {
      _currentUserData = undefined;
      xhr.restore();
    });

    it('should post an error message if not logged in', function() {
      _currentUserData.userName = undefined;
      handlers.postEvent = sandbox.spy();
      handlers['talkilla.logout']({
        topic: 'talkilla.logout',
        data: null
      });

      sinon.assert.calledOnce(handlers.postEvent);
      sinon.assert.calledWith(handlers.postEvent, 'talkilla.error');
    });

    it('should tear down the websocket', function() {
      handlers['talkilla.logout']({
        topic: 'talkilla.logout',
        data: null
      });

      sinon.assert.calledOnce(_presenceSocket.close);
    });

    it("should post an ajax message to the server",
      function() {
        handlers['talkilla.logout']({
          topic: 'talkilla.logout'
        });
        expect(requests.length).to.equal(1);
        expect(requests[0].url).to.equal('/signout');
        expect(requests[0].requestBody).to.be.not.empty;
        expect(requests[0].requestBody).to.be.equal('{"nick":"romain"}');
      });

    describe("Success logout", function() {
      var port;

      beforeEach(function () {
        port = {id: "tests", postEvent: sandbox.spy()};
        ports.add(port);

        sandbox.stub(_currentUserData, "reset");

        handlers['talkilla.logout']({
          topic: 'talkilla.logout'
        });

        requests[0].respond(200, { 'Content-Type': 'text/plain' },
          'OK' );
      });

      afterEach(function() {
        ports.remove(port);
      });

      it("should post a success message",
        function() {
          sinon.assert.calledOnce(port.postEvent);
          sinon.assert.calledWith(port.postEvent, 'talkilla.logout-success');
          ports.remove(port);
        });

      it("should reset the current user data", function() {
        sinon.assert.calledOnce(_currentUserData.reset);
      });
    });


    it("should log failure, if the server failed to sign the user out",
      function() {
        handlers.postEvent = sandbox.spy();
        handlers['talkilla.logout']({
          topic: 'talkilla.logout'
        });

        expect(requests.length).to.equal(1);

        requests[0].respond(401, { 'Content-Type': 'text/plain' },
                            'Not Authorised' );

        sinon.assert.calledOnce(handlers.postEvent);
        sinon.assert.calledWith(handlers.postEvent, 'talkilla.error');
      });
  });

  describe("talkilla.call-start", function() {
    beforeEach(function() {
      browserPort = {postEvent: sandbox.spy()};
    });

    afterEach(function() {
      browserPort = undefined;
    });

    it("should open a chat window when receiving a talkilla.call-start event",
      function() {
        handlers.postEvent = sinon.spy();
        handlers['talkilla.call-start']({
          topic: "talkilla.call-start",
          data: {}
        });

        sinon.assert.calledOnce(browserPort.postEvent);
        sinon.assert.calledWithExactly(browserPort.postEvent,
          'social.request-chat', "chat.html");
      });
  });

  describe("talkilla.offer-timeout", function() {
    var sandbox;

    beforeEach(function() {
      sandbox = sinon.sandbox.create();
      sandbox.stub(ports, "broadcastEvent");
    });

    afterEach(function() {
      browserPort = undefined;
      sandbox.restore();
    });

    it("should notify the caller that an outgoing call did not go through",
      function() {
        var fakeCallData = {foo: "bar"};
        handlers['talkilla.offer-timeout']({
          topic: "talkilla.offer-timeout",
          data: fakeCallData
        });

        sinon.assert.calledOnce(ports.broadcastEvent);
        sinon.assert.calledWithExactly(ports.broadcastEvent,
          "talkilla.offer-timeout", fakeCallData);
      });
  });

  describe("talkilla.chat-window-ready", function() {
    beforeEach(function() {
      browserPort = {postEvent: sandbox.spy()};
      _currentUserData = new UserData();
    });

    afterEach(function() {
      _currentUserData = undefined;
      browserPort = undefined;
    });

    it("should post a talkilla.login-success event when " +
      "receiving a talkilla.chat-window-ready",
      function () {
        var chatAppPort = {postEvent: sinon.spy()};
        _currentUserData.userName = "bob";

        handlers['talkilla.chat-window-ready'].bind(chatAppPort)({
          topic: "talkilla.chat-window-ready",
          data: {}
        });

        sinon.assert.called(chatAppPort.postEvent);
        sinon.assert.calledWithExactly(chatAppPort.postEvent,
          'talkilla.login-success', {username: "bob"});
      });


    it("should post a talkilla.call-start event when " +
      "receiving a talkilla.chat-window-ready for an outgoing call",
      function () {
        var chatAppPort = {postEvent: sinon.spy()};
        currentCall = {
          port: chatAppPort,
          data: {
            caller: "alice",
            callee: "bob"
          }
        };

        handlers['talkilla.chat-window-ready'].bind(chatAppPort)({
          topic: "talkilla.chat-window-ready",
          data: {}
        });

        sinon.assert.called(chatAppPort.postEvent);
        sinon.assert.calledWithExactly(chatAppPort.postEvent,
          'talkilla.call-start', currentCall.data);
      });

    it("should post a talkilla.call-incoming event when " +
      "receiving a talkilla.chat-window-ready for an incoming call",
       function () {
        var chatAppPort = {postEvent: sinon.spy()};
        currentCall = {
          port: undefined,
          data: {
            caller: "alice",
            callee: "bob",
            offer: {type: "fake", sdp: "sdp"}
          }
        };

        handlers['talkilla.chat-window-ready'].bind(chatAppPort)({
          topic: "talkilla.chat-window-ready",
          data: {}
        });

        sinon.assert.called(chatAppPort.postEvent);
        sinon.assert.calledWithExactly(chatAppPort.postEvent,
          'talkilla.call-incoming', currentCall.data);
      });

    it("should store the current port when " +
      "receiving a talkilla.chat-window-ready for an outgoing call",
      function () {
        var port = {postEvent: sinon.spy()};
        currentCall = {port: undefined, data: {caller: "alice", callee: "bob"}};

        handlers['talkilla.chat-window-ready'].bind(port)({
          topic: "talkilla.chat-window-ready",
          data: {}
        });

        expect(currentCall.port).to.be.equal(port);
      });
  });

  describe("Call offers and answers", function() {
    beforeEach(function() {
      browserPort = {postEvent: sandbox.spy()};
    });

    afterEach(function() {
      browserPort = undefined;
    });

    it("should send a websocket message when receiving talkilla.call-offer",
      function() {
        _presenceSocketSendMessage = sandbox.spy();
        var data = {
          caller: "fred",
          callee: "tom",
          offer: { sdp: "sdp", type: "type" }
        };

        handlers['talkilla.call-offer']({
          topic: "talkilla.call-offer",
          data: data
        });

        sinon.assert.calledOnce(_presenceSocketSendMessage);
        sinon.assert.calledWithExactly(_presenceSocketSendMessage,
         JSON.stringify({'call_offer': data }));
      });

    it("should send a websocket message when receiving talkilla.call-answer",
      function() {
        _presenceSocketSendMessage = sandbox.spy();
        var data = {
          caller: "fred",
          callee: "tom",
          offer: { sdp: "sdp", type: "type" }
        };

        handlers['talkilla.call-answer']({
          topic: "talkilla.call-answer",
          data: data
        });

        sinon.assert.calledOnce(_presenceSocketSendMessage);
        sinon.assert.calledWithExactly(_presenceSocketSendMessage,
         JSON.stringify({ 'call_accepted': data }));
      });

    it("should send a websocket message when receiving talkilla.call-hangup",
      function() {
        _presenceSocketSendMessage = sandbox.spy();
        var data = {
          other: "florian"
        };

        handlers['talkilla.call-hangup']({
          topic: "talkilla.call-hangup",
          data: data
        });

        sinon.assert.calledOnce(_presenceSocketSendMessage);
        sinon.assert.calledWithExactly(_presenceSocketSendMessage,
         JSON.stringify({ 'call_hangup': data }));
      });

    it("should reset the call data when receiving talkilla.call-hangup",
      function() {
        currentCall = {
          port: {},
          data: { caller: "romain", callee: "florian" }
        };
        _presenceSocketSendMessage = sandbox.spy();
        var data = {
          other: "florian"
        };

        handlers['talkilla.call-hangup']({
          topic: "talkilla.call-hangup",
          data: data
        });

        expect(currentCall).to.be.equal(undefined);
      });
  });

  describe("#incoming_call", function() {
    beforeEach(function() {
      browserPort = {postEvent: sandbox.spy()};
    });

    afterEach(function() {
      browserPort = undefined;
    });

    it("should store the current call data", function() {
      var data = {
        caller: "bob",
        callee: "alice",
        offer: {type: "fake", sdp: "sdp" }
      };
      serverHandlers.incoming_call(data);

      expect(currentCall).to.deep.equal({port: undefined, data: data});
    });

    it("should open a chat window", function() {
      serverHandlers.incoming_call({});

      sinon.assert.calledOnce(browserPort.postEvent);
      sinon.assert.calledWithExactly(browserPort.postEvent,
        'social.request-chat', "chat.html");
    });
  });

  describe("#call_accepted", function() {

    it("should post talkilla.call-establishment to the chat window",
      function() {
        var port = {postEvent: sinon.spy()};
        var data = {
          caller: "alice",
          callee: "bob",
          answer: { type: "fake", sdp: "sdp" }
        };

        currentCall = {port: port, data: {caller: "alice", callee: "bob"}};

        serverHandlers.call_accepted(data);

        sinon.assert.calledOnce(port.postEvent);
        sinon.assert.calledWithExactly(port.postEvent,
          'talkilla.call-establishment', data);
      });
  });

  describe("#call_hangup", function() {
    var callData;

    beforeEach(function() {
      handlers.postEvent = sandbox.spy();
      callData = {
        other: "bob"
      };
      currentCall = {port: {postEvent: handlers.postEvent}, data: callData};
    });

    it("should notify the chat window", function() {
      serverHandlers.call_hangup(callData);

      sinon.assert.calledOnce(handlers.postEvent);
      sinon.assert.calledWithExactly(handlers.postEvent,
        'talkilla.call-hangup', callData);
    });

    it("should clear the current call data", function() {
      serverHandlers.call_hangup(callData);

      expect(currentCall).to.be.equal(undefined);
    });
  });

  describe("#tryPresenceSocket", function() {
    var wsurl = "ws://example.com/", oldConfig;

    beforeEach(function() {
      oldConfig = _.clone(_config);
      _config.WSURL = wsurl;
    });

    afterEach(function() {
      _config = oldConfig;
    });

    it("should create a websocket and attach it to _presenceSocket",
      function() {
        var fakeWS = {addEventListener: function () {}};
        var url = wsurl + "?nick=toto";
        sandbox.stub(window, "WebSocket").returns(fakeWS);

        tryPresenceSocket("toto");

        expect(_presenceSocket).to.equal(fakeWS);
        sinon.assert.calledOnce(window.WebSocket);
        sinon.assert.calledWithExactly(window.WebSocket, url);
      });

    it("should attach _presenceSocketReAttached to the open event",
      function() {
        var nbCall = 1;

        var fakeWS = {
          addEventListener: function(eventname, callback) {
            if (nbCall === 1) {
              expect(eventname).to.equal("open");
              callback();
              sinon.assert.calledOnce(_presenceSocketReAttached);
              sinon.assert.calledWithExactly(_presenceSocketReAttached, "toto");
            }
            nbCall += 1;
          }
        };

        sandbox.stub(window, "WebSocket").returns(fakeWS);
        sandbox.stub(window, "_presenceSocketReAttached");
        sandbox.stub(window.ports, "broadcastEvent");

        tryPresenceSocket("toto");
      });

    it("should attach _loginExpired to the error event", function() {
      var fakeWS = {addEventListener: sinon.spy()};
      sandbox.stub(window, "WebSocket").returns(fakeWS);
      sandbox.stub(window.ports, "broadcastEvent");

      tryPresenceSocket("toto");

      sinon.assert.called(fakeWS.addEventListener);
      sinon.assert.calledWithExactly(
        fakeWS.addEventListener, "error", _loginExpired);
    });

    it("should send a talkilla.presence-pending event", function() {
      var fakeWS = {addEventListener: function() {}};
      sandbox.stub(window, "WebSocket").returns(fakeWS);
      sandbox.stub(window.ports, "broadcastEvent");

      tryPresenceSocket("toto");

      sinon.assert.calledOnce(ports.broadcastEvent);
      sinon.assert.calledWithExactly(
        ports.broadcastEvent, "talkilla.presence-pending", {});
    });
  });

  describe("#_setupWebSocket", function() {

    it("should attach _presenceSocketOnOpen to the open event", function() {
      var fakeWS = {};

      _setupWebSocket(fakeWS);

      expect(fakeWS.onopen).to.equal(_presenceSocketOnOpen);
    });

    it("should attach _presenceSocketOnMessage to the message event",
      function() {
        var fakeWS = {};

        _setupWebSocket(fakeWS);

        expect(fakeWS.onmessage).to.equal(_presenceSocketOnMessage);
      });

    it("should attach _presenceSocketOnError to the error event", function() {
      var fakeWS = {};

      _setupWebSocket(fakeWS);

      expect(fakeWS.onerror).to.equal(_presenceSocketOnError);
    });

    it("should attach _presenceSocketOnClose to the close event", function() {
      var fakeWS = {};

      _setupWebSocket(fakeWS);

      expect(fakeWS.onclose).to.equal(_presenceSocketOnClose);
    });
  });

  describe("#_loginExpired", function() {

    beforeEach(function () {
      _presenceSocket = {removeEventListener: sinon.spy()};
    });

    it("should remove itself from the listeners", function () {
      _loginExpired();

      sinon.assert.calledOnce(_presenceSocket.removeEventListener);
      sinon.assert.calledWithExactly(
        _presenceSocket.removeEventListener, "error", _loginExpired);
    });

    it("should broadcast a talkilla.logout-success event", function () {
      sandbox.stub(window.ports, "broadcastEvent");

      _loginExpired();

      sinon.assert.calledOnce(ports.broadcastEvent);
      sinon.assert.calledWithExactly(
        ports.broadcastEvent, "talkilla.logout-success", {});
    });

  });

  describe("#_presenceSocketReAttached", function () {

    beforeEach(function () {
      _presenceSocket = {removeEventListener: sinon.spy()};
      _currentUserData = new UserData();
    });

    afterEach(function () {
      _currentUserData = undefined;
    });

    it("should remove itself from the listeners", function () {
      _presenceSocketReAttached("toto");

      sinon.assert.calledOnce(_presenceSocket.removeEventListener);
      sinon.assert.calledWithExactly(
        _presenceSocket.removeEventListener, "open", _presenceSocketReAttached);
    });

    it("should setup the websocket", function () {
      sandbox.stub(window, "_setupWebSocket");
      sandbox.stub(window, "_presenceSocketOnOpen");

      _presenceSocketReAttached();

      sinon.assert.calledOnce(_setupWebSocket);
    });

    it("should call _presenceSocketOnOpen forwarding the given event",
      function () {
        sandbox.stub(window, "_presenceSocketOnOpen");

        _presenceSocketReAttached("nickname", "event");

        sinon.assert.calledOnce(_presenceSocketOnOpen);
        sinon.assert.calledWithExactly(_presenceSocketOnOpen, "event");
      });

    it("should broadcast a talkilla.login-success event", function () {
      sandbox.stub(window.ports, "broadcastEvent");
      sandbox.stub(window, "_presenceSocketOnOpen");

      _presenceSocketReAttached("toto");

      sinon.assert.calledOnce(ports.broadcastEvent);
      sinon.assert.calledWithExactly(
        ports.broadcastEvent, "talkilla.login-success", {username: "toto"});
    });

  });

  describe("talkilla.sidebar-ready", function() {

    beforeEach(function() {
      _currentUserData = new UserData();
    });

    afterEach(function() {
      _currentUserData = undefined;
    });

    it("should call tryPresenceSocket when receiving" +
       "a talkilla.sidebar-ready event", function () {
      sandbox.stub(window, "tryPresenceSocket");

      handlers['talkilla.sidebar-ready']({
        topic: "talkilla.sidebar-ready",
        data: {nick: "toto"}
      });

      sinon.assert.calledOnce(tryPresenceSocket);
      sinon.assert.calledWithExactly(tryPresenceSocket, "toto");
    });

    it("should NOT call tryPresenceSocket if there is no nick provided",
      function () {
        sandbox.stub(window, "tryPresenceSocket");

        handlers['talkilla.sidebar-ready']({
          topic: "talkilla.sidebar-ready",
          data: {}
        });

        sinon.assert.notCalled(tryPresenceSocket);
      });
  });

});
