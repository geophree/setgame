var Game = function(hash, minPlayers) {
  this.players = [null, null, null, null, null, null, null, null];
  this.hash = hash;
  this.puzzled = [];
  this.messages = [];
  this.minPlayers = minPlayers;
  this.started = !minPlayers;
  this.hinted = null;
  this.winner = null;

  this.reset();
}

Game.prototype.resetDeck = function() {
  for (var i = 0; i < 81; i++) {
    this.deck.push( new Card(i) );
  }
  shuffle(this.deck);
}

Game.prototype.reset = function() {
  this.deck = [];
  this.board = [];
  this.players.forEach(function(player) {
    if (player !== null) player.score = 0;
  });
  this.resetDeck();
  for (var i = 0; i < 12; i++) {
    this.board.push(this.deck.pop());
  }
}

Game.prototype.getActivePlayers = function() {
  return this.players.filter( function(player) {
    return player !== null && player.online;
  });
}

Game.prototype.numPlayers = function() {
  return this.getActivePlayers().length;
}

Game.prototype.firstAvailablePlayerSlot = function() {
  for (var i = 0; i < this.players.length; i++) {
    if (this.players[i] === null) return i;
  }
  for (var i = 0; i < this.players.length; i++) {
    if (!this.players[i].online) return i;
  }
  return 0;
}

Game.prototype.getPlayerIdx = function(client) {
  for (var i = 0; i < this.players.length; i++) {
    if (this.players[i] !== null &&
        this.players[i].client.sessionId === client.sessionId)
      return i;
  }
  return -1;
}

Game.prototype.playerData = function() {
  ret = {};
  for (var i = 0; i < this.players.length; i++) {
    var player = this.players[i];
    if (player !== null) {
      ret[i] = {
        score: player.score
      , online: player.online
      };
    }
  }
  return ret;
}

Game.prototype.registerClient = function(client, sess) {
  if (this.numPlayers() >= this.players.length) return false;
  var self = this;
  
  for (var i = 0; i < this.players.length; i++) {
    var player = this.players[i];
    if (player === null) continue;
    if (player.client.sessionId === client.sessionId || player.sess === sess) {
      if (!player.online) {
        this.broadcast({action: 'rejoin', player: i});
        this.sendMsg({event: true, msg: 'Player ' + (i + 1) + ' has reconnected.'});
      }
      player.online = true;
      player.client = client;
      player.sess = sess;
      this.updateRemaining();
      return true;
    }
  }

  var playerIdx = this.firstAvailablePlayerSlot();
  this.broadcast({action: 'join', player: playerIdx});
  this.sendMsg({event: true, msg: 'Player ' + (playerIdx + 1) + ' has joined.'});
  this.players[playerIdx] = new Player(client, sess);
  this.updateRemaining();

  setTimeout(function() {
    if (!self.started && self.numPlayers() >= self.minPlayers) {
      self.started = true;
      self.broadcast({action: 'start'});
      self.reset();
    }
  }, 2000);
  return true;
}

Game.prototype.unregisterClient = function(client, gameOver) {
  var playerIdx = this.getPlayerIdx(client);
  if (playerIdx === -1) return;
  var self = this;
  
  this.players[playerIdx].online = false;
  this.broadcast({action: 'leave', player: playerIdx});
  this.updateRemaining();
  this.sendMsg({event: true, msg: 'Player ' + (playerIdx + 1) + ' has disconnected.'});
  setTimeout( function delayGameover() {
    if (self.numPlayers() === 0) gameOver();
  }, 3600000);
}

Game.prototype.updateRemaining = function() {
  if (this.started) return;
  this.broadcast({action: 'remaining', remaining: this.minPlayers - this.numPlayers()});
}

Game.prototype.broadcast = function(message) {
  console.log(this.hash + ' broadcasting: ');
  console.log(message);
  this.players.forEach( function(player) {
    if (player !== null) player.client.send(message);
  });
}

Game.prototype.sendMsg = function(msg) {
  this.messages.push(msg);
  if (this.messages.length > 15) this.messages.shift();
  msg.action = 'msg';
  this.broadcast(msg);
}

Game.prototype.message = function(client, message) {
  if (!message.action) return;
  var player = this.getPlayerIdx(client);
  if (player === -1) return;
  var self = this;
  console.log('player ' + player + ' sends: ');
  console.log(message);
  
  if (message.action === 'init') {
    return client.send({
        action: 'init'
      , board: this.board
      , players: this.playerData()
      , you: player
      , msgs: this.messages
      , remaining: this.started ? 0 : this.minPlayers - this.numPlayers()
    });
  }
  
  if (message.action === 'take' &&
      'selected' in message &&
      message.selected.length === 3)
  {
    if (this.checkSet(message.selected)) {
      console.log('take set succeed');
      var update = {};
      if (!this.started && this.deck.length === 0) this.resetDeck();
      if (this.board.length <= 12 && this.deck.length > 0) {
          message.selected.forEach( function(val) {
            var c = this.deck.pop();
            update[val] = c;
            this.board[val] = c;
          }, this );
      } else {
        var lastRow = this.board.length - 3;
        var lastReplace = this.board.length - 1;
        message.selected.sort( function reverse(a, b) { return b - a; } );
        message.selected.forEach( function(val) {
          if (val >= lastRow) {
            update[val] = false;
          } else {
            while (message.selected.indexOf(lastReplace) != -1)
              lastReplace--;
            update[val] = lastReplace--;
            this.board[val] = this.board[update[val]];
          }
        }, this);
        this.board.splice(lastRow, 3);
      }
      this.players[player].score += (this.started ? 3 : 0);

      if (this.winner === null ||
          !this.players[this.winner].online ||
          this.players[player].score > this.players[this.winner].score) {
        this.winner = player;
      }
        
      var playerUpdate = {};
      playerUpdate[player] = {score: this.players[player].score};
      this.puzzled = [];
      this.hinted = null;
      this.broadcast({
          action: 'taken'
        , update: update
        , player: player
        , players: playerUpdate
      });

      if (this.deck.length === 0 && !this.checkSetExistence()) {
        var message = {
            action: 'win'
          , player: this.winner
        };
        setTimeout(function() { self.broadcast(message); }, 2000);
        this.reset();
      }
    } else {
      console.log('take set failed');
    }
    return;
  }

  if (message.action === 'hint') {
    if (this.puzzled.indexOf(player) != -1) return;
    this.puzzled.push(player);
    this.broadcast({
        action: 'puzzled'
      , player: player
    });
    var self = this;
    setTimeout(function() {
      console.log('hint timeout executing');
      if (self.puzzled.length < Math.ceil(self.numPlayers() * 0.51)) return;
      if (!self.hinted) {
        var setExists = self.checkSetExistence();
        if (setExists) {
          self.hinted = setExists;
        } else if (self.deck.length > 0) {
          var newCards = [];
          for (var i = 0; i < 3; i++) newCards.push(self.deck.pop());
          self.board = self.board.concat(newCards);
          self.broadcast({
              action: 'add'
            , cards: newCards
          });
        }
      }
      if (self.hinted && self.hinted.length > 0) {
        self.broadcast({
            action: 'hint'
          , card: self.hinted.pop()
        });
      }
      self.puzzled = [];
    }, 1000);
    return;
  }

  if (message.action === 'msg' &&
      'msg' in message &&
      message.msg.length < 1024)
  {
    var msg = message.msg.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
    return this.sendMsg({ player: player, msg: msg });
  }
}

Game.prototype.checkSetExistence = function() {
  if (this.board.length < 3) return false;
  var randoffs = Math.floor(Math.random() * this.board.length);
  for (var i = 0; i < this.board.length - 2; i++) {
  for (var j = i + 1; j < this.board.length - 1; j++) {
  for (var k = j + 1; k < this.board.length; k++) {
    var _i = (i + randoffs) % this.board.length
      , _j = (j + randoffs) % this.board.length
      , _k = (k + randoffs) % this.board.length;
    if (this.verifySet(this.board[_i],this.board[_j],this.board[_k])) return shuffle([_i,_j,_k]);
  }}}
  return false;
}

Game.prototype.checkSet = function(indexes) {
  indexes = indexes.unique();
  if (indexes.length != 3) return false;
  if (!indexes.every( function valid(index) {
    return (index >= 0 && index < this.board.length);
  }, this)) {
    return false;
  }
  return this.verifySet(this.board[indexes[0]], this.board[indexes[1]], this.board[indexes[2]]);
}

// hardcoding and unrolling all this for speed, possibly premature optimization
Game.prototype.verifySet = function(c0, c1, c2) {
  var s = c0.number + c1.number + c2.number;
  if (s != 0 && s != 3 && s != 6) return false;
  s = c0.color + c1.color + c2.color;
  if (s != 0 && s != 3 && s != 6) return false;
  s = c0.shape + c1.shape + c2.shape;
  if (s != 0 && s != 3 && s != 6) return false;
  s = c0.shading + c1.shading + c2.shading;
  if (s != 0 && s != 3 && s != 6) return false;
  return true;
}


function Card(idx) {
  this.number = idx % 3;
  idx = Math.floor(idx / 3);
  this.color = idx % 3;
  idx = Math.floor(idx / 3);
  this.shape = idx % 3;
  idx = Math.floor(idx / 3);
  this.shading = idx % 3;
}

function Player(client, sess) {
  this.client = client;
  this.score = 0;
  this.sess = sess;
  this.online = true;
}

//+ Jonas Raoni Soares Silva
//@ http://jsfromhell.com/array/shuffle [rev. #1]
function shuffle(v){
    for(var j, x, i = v.length;
      i;
      j = Math.floor(Math.random() * i), x = v[--i], v[i] = v[j], v[j] = x)
    ;
    return v;
};

// **************************************************************************
// Copyright 2007 - 2009 Tavs Dokkedahl
// Contact: http://www.jslab.dk/contact.php
//
// This file is part of the JSLab Standard Library (JSL) Program.
//
// JSL is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 3 of the License, or
// any later version.
//
// JSL is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <http://www.gnu.org/licenses/>.
// ***************************************************************************

// Return new array with duplicate values removed
Array.prototype.unique = function() {
  var a = [];
  var l = this.length;
  for(var i=0; i<l; i++) {
    for(var j=i+1; j<l; j++) {
      // If this[i] is found later in the array
      if (this[i] === this[j])
        j = ++i;
    }
    a.push(this[i]);
  }
  return a;
};

module.exports = Game;
