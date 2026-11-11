/* ============================================================
 * 《这排我占了！》音效引擎
 * 全部使用 Web Audio API 实时合成，不依赖任何外部音频资源。
 * ============================================================ */
window.Sound = (function () {
  'use strict';

  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var enabled = true;
  var supported = true;

  function AC() {
    return window.AudioContext || window.webkitAudioContext;
  }

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    var Ctor = AC();
    if (!Ctor) { supported = false; return; }
    try {
      ctx = new Ctor();
    } catch (e) {
      supported = false;
      return;
    }
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }

  function ready() { return !!ctx && enabled; }
  function now() { return ctx ? ctx.currentTime : 0; }

  /* ---------------- 基础发声单元 ---------------- */

  function tone(o) {
    if (!ready()) return;
    var freq = o.freq || 440;
    var dur = o.dur || 0.15;
    var t0 = now() + (o.delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
    var peak = o.gain == null ? 0.18 : o.gain;
    var atk = o.attack == null ? 0.006 : o.attack;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function getNoise() {
    if (!noiseBuf) {
      var len = Math.floor(ctx.sampleRate * 0.6);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  function noise(o) {
    if (!ready()) return;
    var dur = o.dur || 0.1;
    var t0 = now() + (o.delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = getNoise();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lp || 3000;
    lp.Q.value = o.q || 1;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = o.hp || 200;
    var g = ctx.createGain();
    g.gain.setValueAtTime(o.gain == null ? 0.2 : o.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp); lp.connect(hp); hp.connect(g); g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  /* ---------------- 对外音效 ---------------- */

  var api = {
    init: init,
    isEnabled: function () { return enabled; },
    isSupported: function () { return supported; },
    setEnabled: function (v) {
      enabled = !!v;
      if (enabled) { init(); if (master) master.gain.value = 0.55; }
      else if (master) master.gain.value = 0;
      return enabled;
    },
    toggle: function () { return api.setEnabled(!enabled); },

    /* 上课铃“叮铃铃——” */
    bell: function () {
      if (!ready()) return;
      for (var i = 0; i < 8; i++) {
        var d = i * 0.105;
        tone({ freq: 1760, dur: 0.085, type: 'sine', gain: 0.11, delay: d });
        tone({ freq: 2637, dur: 0.06, type: 'sine', gain: 0.05, delay: d + 0.01 });
      }
      tone({ freq: 880, dur: 0.5, type: 'sine', gain: 0.05, delay: 0.05 });
    },

    /* 开场短促提示音 */
    start: function () {
      tone({ freq: 520, to: 1240, dur: 0.22, type: 'triangle', gain: 0.2 });
      tone({ freq: 1046, dur: 0.16, type: 'square', gain: 0.05, delay: 0.2 });
      tone({ freq: 1568, dur: 0.22, type: 'sine', gain: 0.11, delay: 0.22 });
    },

    /* 倒计时滴答 */
    tick: function (hi) {
      tone({ freq: hi ? 1320 : 780, dur: 0.1, type: 'sine', gain: 0.14 });
      if (hi) tone({ freq: 1980, dur: 0.14, type: 'sine', gain: 0.09, delay: 0.03 });
    },

    /* 普通占座“啪！”——连续抢座时音调逐级升高 */
    claim: function (combo) {
      var c = Math.min(combo || 1, 20);
      var f = 280 + c * 34;
      noise({ dur: 0.05, gain: 0.2, lp: 2600, hp: 700 });
      tone({ freq: f, to: f * 0.5, dur: 0.085, type: 'triangle', gain: 0.12 });
      if (c > 1) tone({ freq: f * 2.5, dur: 0.07, type: 'sine', gain: 0.05, delay: 0.02 });
    },

    /* 特殊座位“叮！” */
    special: function () {
      tone({ freq: 1046, dur: 0.12, type: 'sine', gain: 0.15 });
      tone({ freq: 1568, dur: 0.16, type: 'sine', gain: 0.13, delay: 0.085 });
      tone({ freq: 2093, dur: 0.34, type: 'sine', gain: 0.11, delay: 0.17 });
      noise({ dur: 0.28, gain: 0.045, lp: 9000, hp: 3200, delay: 0.17 });
    },

    /* 抢座失败 / 被抢“啊！” */
    steal: function () {
      tone({ freq: 360, to: 150, dur: 0.24, type: 'sawtooth', gain: 0.1 });
      tone({ freq: 226, to: 108, dur: 0.28, type: 'square', gain: 0.05, delay: 0.02 });
    },

    /* 技能发动 */
    skill: function () {
      tone({ freq: 520, to: 1040, dur: 0.12, type: 'triangle', gain: 0.14 });
      tone({ freq: 780, to: 1560, dur: 0.16, type: 'sine', gain: 0.11, delay: 0.05 });
      tone({ freq: 1180, dur: 0.2, type: 'sine', gain: 0.08, delay: 0.12 });
    },

    /* 双人同座竞争“抢！” */
    clash: function () {
      tone({ freq: 660, to: 1320, dur: 0.1, type: 'square', gain: 0.07 });
      tone({ freq: 990, dur: 0.14, type: 'triangle', gain: 0.13, delay: 0.02 });
      tone({ freq: 1480, dur: 0.18, type: 'sine', gain: 0.1, delay: 0.09 });
      noise({ dur: 0.12, gain: 0.1, lp: 6000, hp: 1800 });
    },

    /* 撞击“砰！” */
    crash: function () {
      noise({ dur: 0.36, gain: 0.32, lp: 900, hp: 50 });
      tone({ freq: 130, to: 44, dur: 0.42, type: 'sine', gain: 0.28 });
    },

    /* 撞墙小顿挫 */
    bump: function () {
      noise({ dur: 0.06, gain: 0.1, lp: 700, hp: 60 });
      tone({ freq: 150, to: 96, dur: 0.08, type: 'sine', gain: 0.09 });
    },

    /* 里程碑 */
    milestone: function () {
      var s = [523, 659, 784, 1046];
      for (var i = 0; i < s.length; i++) {
        tone({ freq: s[i], dur: 0.2, type: 'triangle', gain: 0.13, delay: i * 0.07 });
      }
    },

    /* 下课 / 游戏结束 */
    over: function () {
      var s = [784, 659, 523, 392];
      for (var i = 0; i < s.length; i++) {
        tone({ freq: s[i], dur: 0.34, type: 'triangle', gain: 0.15, delay: i * 0.17 });
      }
      tone({ freq: 196, dur: 0.9, type: 'sine', gain: 0.1, delay: 0.68 });
    },

    /* 界面点击 */
    ui: function () {
      tone({ freq: 660, to: 1040, dur: 0.1, type: 'triangle', gain: 0.13 });
    }
  };

  return api;
})();
