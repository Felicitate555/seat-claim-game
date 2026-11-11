/* 联机层：基于 PeerJS 的 WebRTC 点对点连接。
 *
 * 为什么不用后端：项目是纯静态站，没有服务器可用。
 * PeerJS 自带一个免费公共信令服务（0.peerjs.com）只负责「牵线」，
 * 真正建立的是浏览器之间的 P2P 数据通道，之后通信不经过任何服务器。
 *
 * 用法：
 *   Net.host(room, handlers)   房主：以房间号为 ID 注册自己，等待访客连进来
 *   Net.join(room, handlers)   访客：连到指定房间号
 *   Net.send(obj)              发消息（对象会被 JSON 序列化）
 *   Net.close()                断开
 */
var Net = (function () {
  var peer = null;
  var conn = null;
  var role = null;
  var handlers = {};
  var room = '';

  function emit(name, a, b) {
    if (handlers[name]) { try { handlers[name](a, b); } catch (e) {} }
  }

  function attach(c) {
    conn = c;
    c.on('open', function () { emit('open'); });
    c.on('data', function (d) { emit('message', d); });
    c.on('close', function () { emit('close'); });
    c.on('error', function (e) { emit('error', e); });
  }

  function makeRoomId(r) {
    /* 房间号要能当 PeerJS 的 id：只允许字母数字和 - _ */
    return ('zz-' + String(r || '').replace(/[^0-9a-zA-Z_-]/g, '')).slice(0, 40);
  }

  return {
    /* 生成 4 位房间号（去掉容易看错的 0/O、1/I） */
    newRoom: function () {
      var chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      var s = '';
      for (var i = 0; i < 4; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
      return s;
    },

    host: function (r, h) {
      handlers = h || {};
      role = 'host';
      room = makeRoomId(r);
      if (typeof Peer === 'undefined') { emit('error', { type: 'no-peerjs' }); return; }
      try {
        peer = new Peer(room);
      } catch (e) { emit('error', e); return; }

      peer.on('open', function () { emit('ready'); });
      peer.on('connection', function (c) { attach(c); });
      peer.on('error', function (e) { emit('error', e); });
      peer.on('disconnected', function () { emit('close'); });
    },

    join: function (r, h) {
      handlers = h || {};
      role = 'guest';
      room = makeRoomId(r);
      if (typeof Peer === 'undefined') { emit('error', { type: 'no-peerjs' }); return; }
      try {
        peer = new Peer();
      } catch (e) { emit('error', e); return; }

      peer.on('open', function () {
        var c = peer.connect(room, { reliable: false });
        if (!c) { emit('error', { type: 'connect-failed' }); return; }
        attach(c);
      });
      peer.on('error', function (e) { emit('error', e); });
      peer.on('disconnected', function () { emit('close'); });
    },

    send: function (obj) {
      if (!conn || !conn.open) return false;
      try { conn.send(obj); return true; } catch (e) { return false; }
    },

    connected: function () { return !!(conn && conn.open); },
    role: function () { return role; },
    room: function () { return room; },

    close: function () {
      try { if (conn) conn.close(); } catch (e) {}
      try { if (peer) peer.destroy(); } catch (e) {}
      conn = null; peer = null; role = null;
    }
  };
})();
