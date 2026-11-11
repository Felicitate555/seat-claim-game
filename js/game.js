/* ============================================================
 * 《这排我占了！》校园抢座小游戏
 * 核心逻辑 + 渲染 + 交互
 * ------------------------------------------------------------
 * 玩法：走过去的空座位自动变成“我占了！”，占下的座位会加入你的
 *       占座路线并挡住去路。抢得越多，教室越挤，越容易把自己堵死。
 * ============================================================ */
(function () {
'use strict';

/* ==========================================================
 * 1. 基础常量与几何
 * ========================================================== */

/* ---------- 布局：桌面用标准版，小屏（手机）用紧凑版 ----------
 * 所有尺寸都由 configureLayout() 决定，渲染代码里不能再出现硬编码坐标，
 * 否则换布局就会错位。 */
var COLS = 27, ROWS = 17, TILE = 36;
var WALL_L = 34, WALL_R = 34, WALL_T = 104, WALL_B = 26;
var CW = WALL_L + COLS * TILE + WALL_R;   /* 标准版 1040 */
var CH = WALL_T + ROWS * TILE + WALL_B;   /* 标准版 742 */
var GX = WALL_L, GY = WALL_T;
var COMPACT = false;
var DECO = 1;                  /* 装饰尺寸缩放系数（相对标准版） */

/* ==========================================================
 * 场景（V1.5 第五阶段）
 * ----------------------------------------------------------
 * 手册「七、第五阶段：新增场景」：
 *   图书馆 —— 规则：座位更少。特点：安静区域限制高速移动。
 *   食堂   —— 规则：抢餐桌。特点：随机刷新热门位置。
 *
 * 三个场景各用一份纯数据描述自己（走道疏密、特殊座位倍率、地板/区块配色、
 * 安静区、热门位刷新），布局与移动代码一律**只读 SCENE**，不写死任何场景的数字。
 *
 * ⚠️ 教室（classroom）的参数必须与搭这一层之前**逐字一致**：
 *   走道 6/2/5/3、特殊座位倍率 1（紧凑 0.7）、无安静区、无热门位、
 *   地板渐变与区块地垫配色原样。
 *   这几个值没变，教室场景的核心循环就与之前逐帧相同（由指纹回归证明）——
 *   指纹回归三档全跑教室，所以新增图书馆/食堂对老基线是**纯增量**。
 *
 * 切换场景由 `sceneSet` 完成：它改完 SCENE 后重开一局演示，
 * `resetGame` 里的 buildGrid / placeSpecials / buildBackground 都只读 SCENE，
 * 于是整张图（座位分布、走道、地板配色）跟着换 —— 不用回头动那些函数。 */
var SCENES = {
  /* ---- 教室：默认场景，参数与 V1 完全一致 ---- */
  classroom: {
    id: 'classroom', name: '教室', emoji: '🏫', ready: true,
    /* 走道：每 colMod 列一条纵向走道（偏移 colOff），每 rowMod 行一条横向走道（偏移 rowOff）。
       走道永远不占座、不挡路，是场景里的「活路」。 */
    aisle: { colMod: 6, colOff: 2, rowMod: 5, rowOff: 3 },
    /* 特殊座位数量倍率（标准 / 紧凑） */
    specialK: { normal: 1, compact: 0.7 },
    /* 地板渐变（三档）与座位区地垫配色 —— 教室保持原样 */
    floor: ['#EFD9AE', '#E9D0A0', '#E0C492'],
    tints: ['rgba(255,247,228,.94)', 'rgba(255,241,224,.94)'],
    /* 前墙黑板上的板书 */
    board: { title: '《 高 等 数 学 》', sub: '第 12 周 · 周五 · 第 3-4 节' },
    /* 地板材质：wood 木地板 / carpet 地毯 / tile 防滑地砖 */
    floorStyle: 'wood',
    /* 房间装饰包：决定前墙、左墙、右墙、墙上的小物件各画什么 */
    decor: 'classroom',
    /* 座位图形（第九阶段 P2-5）：'classroom' 方桌 + 椅子条 / 'dining' 圆桌 + 圆凳 + 餐盘。
     * 手册 §七：「不要把餐桌直接当座位复制」—— 换场景只换配色与道具 emoji，
     * 玩家一眼还是那个教室。所以食堂单独一套剪影，见 drawDiningTable。
     * ⚠️ 只有 'dining' 会走另一条路径，其余（含 undefined）逐字走原来那条。 */
    deskStyle: 'classroom',
    /* 调色板覆盖（null = 用基准，即教室那份） */
    pal: null,
    /* 安静区：限制高速移动。null = 本场景没有安静区 */
    quiet: null,
    /* 热门位置：随机刷新。null = 本场景没有热门位 */
    hot: null,
    /* 食堂专属规则（四区域 / 饭菜 / 长龙）。null = 本场景没有 */
    dine: null
  },

  /* ---- 图书馆 / 食堂：手册第五阶段新增的两个场景，现已实现（ready:true）。
   *      图书馆走道更密 → 座位更少；食堂过道更宽 + 热门位随机刷新。 ---- */
  library: {
    id: 'library', name: '图书馆', emoji: '📚', ready: true,
    /* 手册：座位更少（走道更密） */
    aisle: { colMod: 5, colOff: 2, rowMod: 4, rowOff: 2 },
    specialK: { normal: 0.7, compact: 0.5 },
    floor: ['#E9E4D6', '#E0DACB', '#D5CEBD'],
    tints: ['rgba(246,245,238,.94)', 'rgba(238,237,229,.94)'],
    board: { title: '静 音 自 习 室', sub: '请勿喧哗 · 手机静音' },
    /* 图书馆：冷灰蓝的墙面 + 墨绿公告栏 + 深色阅览桌，跟教室的暖黄拉开 */
    floorStyle: 'carpet',
    decor: 'library',
    /* 阅览桌本来就是方桌，沿用教室那套剪影（差异靠配色与墙面装饰承担） */
    deskStyle: 'classroom',
    pal: {
      wall: '#E7E6F0', wallLine: '#C4C2D6',
      board: '#33436B', boardEdge: '#7C86A8',
      chair: '#C9C6D6', chairEdge: '#A6A2B8',
      desk: '#F3F1E6', deskLine: '#B9B4A6'
    },
    /* 手册：安静区域限制高速移动（地图中段 28%~72% 的行） */
    quiet: { dashCancel: true, zone: { r0: 0.28, r1: 0.72 } },
    /* ---------- 图书馆专属规则（V1.5 第六阶段） ----------
     * 核心玩法是「抢学习资源」，不是简单抢座。三个区域各管一件事：
     *   安静区    高分 + 移动速度降低（行区间直接复用上面的 quiet.zone）
     *   插座区    靠墙一条竖带，插座位**只长在这里**且全场只有 plugCount 个（稀缺）
     *   小组讨论区 底部横带，占座额外加分，每 discussEvery 格追加一个「额外任务」
     * 安静值：在安静区里走动就掉，掉到 calmEvict 以下被管理员驱赶。
     * 全部是纯数据 + 纯算术，零 Math.random()。
     * 教室 / 食堂的 lib 是 null → 整节第一行就返回，零开销零随机消耗。 */
    lib: {
      quietSeatMult: 1.4,     /* 安静区座位得分倍率（高分） */
      /* ⚠️ 这是**速度**倍率，不是步进间隔倍率 —— 0.72 = 只有正常速度的 72%（走得更慢）。
         2026-10-03 修：原来它叫 quietStepMult 且被当成间隔直接乘进 actorStepMs，
         于是 130ms 一步变成 93.6ms —— **实际是加速**，和「安静区走得慢」的设定正好相反。
         名字、注释、算式三者当初只有算式生效，所以谁都没发现。 */
      quietSpeedMult: 0.72,
      plugCols: 0.26,         /* 插座区：最左 26% 的列（插座本来就长在墙上） */
      plugCount: 3,           /* 插座区里只长这么几个插座位 —— 稀缺，多人抢 */
      plugBonus: 40,          /* 插座区里的插座位额外 +40（比普通座位值钱） */
      groupRow: 0.72,         /* 小组讨论区：最下 28% 的行 */
      groupBonus: 150,        /* 在讨论区占座额外 +150 */
      discussEvery: 3,        /* 讨论区每占 3 格 → 追加一个「额外任务」 */
      extraTaskMax: 5,        /* 任务列表最多追加到 5 个 */
      calmMax: 100,           /* 安静值上限 */
      /* ⚠️ 掉值是「每秒」不是「每步」。安静区里一步约 181ms（约 5.5 步/秒），
         按步扣的话穿过一次安静区（9 行 ≈ 1.6 秒）就能掉 100 点，等于一进去就被赶 ——
         那不叫压力，叫陷阱。按秒算才有正确的形状：
         横穿一次约 21 点（可以接受），赖在里头乱走 7 秒才会被赶走。 */
      calmMoveDrain: 13,      /* 在安静区里持续走动时每秒掉多少 */
      calmRegen: 9,           /* 不在安静区时每秒恢复多少 */
      calmQuietRegen: 4,      /* 在安静区里站着不动时每秒恢复多少 */
      /* 「算不算在走动」的保持窗口（秒）。2026-10-03 修：
         原来逐帧比较「这一帧有没有跨格」，而一步要 181ms（约 11 帧），
         于是 1 帧掉 13*dt、其余 10 帧各回 4*dt → **净回血**，
         持续走动反而永远掉不到 calmEvict，驱赶机制等于不存在。
         现在改成：跨了一格就把窗口续满，窗口内都算「在走」。
         窗口必须大于「安静区里最慢的一步」——点名危机会再 ×1.6（≈289ms），
         所以取 0.5s 留足余量；停手 0.5 秒后才开始恢复，对应「真正停下再恢复」。 */
      calmMoveHold: 0.5,
      calmEvict: 25,          /* 安静值掉到这个数以下 → 管理员驱赶 */
      calmEvictScore: -120,   /* 驱赶扣分 */
      calmEvictFreeze: 2.0    /* 驱赶后原地罚站几秒 */
    },
    hot: null,
    dine: null
  },
  canteen: {
    id: 'canteen', name: '食堂', emoji: '🍜', ready: true,
    /* 手册：抢餐桌（过道宽）。
       ⚠️ rowOff 必须是 3（rows 3/9/15），不能是 4 —— 4 会让第 16 行（最后一行）
       整行变成走道，而黄金后排恰好摆在最后一行 → 一个黄金座都摆不出来，
       《后排统治者》任务直接变成不可能。同理 colOff 要保证最后一行/首行有座位。 */
    aisle: { colMod: 7, colOff: 3, rowMod: 6, rowOff: 3 },
    specialK: { normal: 1.2, compact: 0.9 },
    floor: ['#F5E6C8', '#F0DCB4', '#E8D0A0'],
    tints: ['rgba(255,246,226,.94)', 'rgba(255,240,212,.94)'],
    board: { title: '今 日 菜 单', sub: '红烧肉 · 糖醋排骨 · 番茄炒蛋' },
    /* 食堂：暖橙墙 + 不锈钢取餐台 + 瓷砖地，一眼就和教室/图书馆区分开 */
    floorStyle: 'tile',
    decor: 'canteen',
    /* 第九阶段 P2-5：餐桌不能是「换了 emoji 的课桌」→ 圆桌 + 圆凳 + 餐盘 */
    deskStyle: 'dining',
    pal: {
      wall: '#F7DFC0', wallLine: '#D9B98D',
      board: '#C1452B', boardEdge: '#8E2F1C',
      chair: '#EFCFA6', chairEdge: '#C9A275',
      desk: '#FFF6E4', deskLine: '#DCC49A'
    },
    quiet: null,
    /* 手册：随机刷新热门位置（每 18 秒换 4 个座位，占下额外 +60 分） */
    hot: { every: 18, count: 4, bonus: 60 },
    /* ---------- 食堂专属规则（V1.5 第七阶段） ----------
     * 手册：「核心玩法：抢热门位置。不是抢座，而是抢资源」。落地成四件事：
     *   ① 四个区域：快速窗口 / 热门档口 / 窗边桌 / 双人桌，各有各的身份
     *   ② 饭菜资源：占座产出饭菜，饭菜再折成分
     *   ③ 排队长龙：路线不断 → 队伍变长 → 每格饭菜按队伍规模放大
     *   ④ 两个特殊事件：开饭铃响（所有学生加速）/ 新菜上线（随机刷高价值区域）
     *
     * ⚠️ 四个区域**按行三段 + 中段左右两带**切分，结构上不可能重叠：
     *      行 1 .. fastRowMax           → 快速窗口（打饭窗口 / 取餐号屏就在上面）
     *      行 fastRowMax+1 .. bottom-1  → 中段：左带 热门档口 / 右带 窗边桌
     *      行 bottomRowMin .. ROWS-1    → 双人桌
     *    这样「一格属于哪个区域」永远只有一个答案，不需要靠优先级去猜
     *    （图书馆的安静区 / 讨论区就吃过这个亏，见 libGroupRowMin）。
     * 全部纯数据 + 纯算术，零 Math.random()。教室 / 图书馆 dine 为 null。 */
    dine: {
      /* ---- 四区域划分（比例，紧凑版也成立） ---- */
      fastRows: 0.24,        /* 顶部 band：前 24% 的行（17 行 → 1~4） */
      bottomRows: 0.24,      /* 底部 band：后 24% 的行（17 行 → 13~16） */
      stallCols: 0.18,       /* 热门档口：中段最左 18% 的列（27 列 → 1~4） */
      windowCols: 0.22,      /* 窗边桌：中段最右 22% 的列（27 列 → 22~25） */

      /* ---- 饭菜资源 ---- */
      foodPerSeat: 1,        /* 每占一格的基础饭菜 */
      fastFood: 2,           /* 快速窗口：出餐快，+2 */
      stallFood: 1,          /* 热门档口：+1 */
      hotCellFoodMult: 2,    /* 占下热门位时饭菜 ×2 */
      foodScore: 4,          /* 每份饭菜折合多少分 */
      windowSeatMult: 1.8,   /* 窗边桌：位置好，座位分更高（但不出饭菜） */

      /* ---- 排队长龙 ---- */
      queueMax: 12,          /* 队伍上限（超过就只是「更长」，不再加乘） */
      queueStep: 0.06,       /* 队伍每长一格 +6% 饭菜；满 12 格 → ×1.72 */
      queueMilestone: 4,     /* 每长这么多格给一次「长龙 N 连」的反馈 */
      pairQueue: 2,          /* 双人桌：一次来俩，每占一格队伍 +2 */
      queueDrawMax: 12,      /* 画面上最多画几个排队的小人（性能上限）
                              * 刻意**等于 queueMax**：队伍画到 12 个时倍率也刚好封顶，
                              * 所以「画面上还在变长」和「倍率还在涨」同时结束，
                              * 玩家不会觉得「明明画到一半就不长了」。
                              * 实测每个小人约 0.087 ms（手机档），12 个 ≈ 1.04 ms，
                              * 而飘带那一次 stroke 几乎免费（0.01 ms）—— 想省就省小人的个数。 */

      /* ---- 特殊事件：开饭铃响 ---- */
      bellDur: 8,            /* 持续 8 秒 */
      bellStepMult: 0.6,     /* 所有学生（NPC + 玩家）步进间隔 ×0.6 —— 全场一起冲 */
      bellBonus: 80,         /* 撑过去 +80 分 */

      /* ---- 特殊事件：新菜上线 ---- */
      dishDur: 12,           /* 高价值区域存在 12 秒 */
      dishW: 2,              /* 区域宽 2 格 */
      dishH: 3,              /* 区域高 3 格 */
      dishFoodMult: 2,       /* 区域里占座的饭菜 ×2 */
      dishScore: 80          /* 区域里占座额外 +80 分 */
    }
  }
};

/* 当前场景。默认教室 —— 与重构前行为一致。 */
var SCENE = SCENES.classroom;

/* 切换场景。未实现的场景直接拒绝并保持原场景不变，返回是否切换成功。
 * 切换成功后**重开一局演示**，让开始页马上反映新场景 ——
 * resetGame 里 buildGrid / placeSpecials / buildBackground 都只读 SCENE，
 * 所以整张图（座位分布、走道、地板配色）跟着换，不用单独重建。 */
function sceneSet(id) {
  var s = SCENES[id];
  if (!s || !s.ready) return false;
  if (SCENE === s) return true;
  SCENE = s;
  applySceneText();         /* 开屏 / HUD 里的静态文案也跟着换（教室口吻别串到食堂） */
  resetGame(true);          /* 重建地图 + 重新摆座位（resetGame 内部会 hotReset） */
  return true;
}
function sceneIs(id) { return SCENE.id === id; }

/* 安静区是否禁止高速移动（手册：图书馆「安静区域限制高速移动」）。
 * 教室 quiet 是 null → 恒 false → 冲刺加速照旧，与 V1 逐字一致。
 * 有 zone 时按「角色是否落在安静区的行区间内」判断；没有 zone 则视为全场安静。 */
function sceneQuietBlocksDash(a) {
  if (!SCENE.quiet || !SCENE.quiet.dashCancel) return false;
  if (!a) return false;
  var z = SCENE.quiet.zone;
  if (!z) return true;
  var r0 = Math.floor(ROWS * z.r0);
  var r1 = Math.ceil(ROWS * z.r1) - 1;
  return a.r >= r0 && a.r <= r1;
}

/* 安静区的行区间（渲染与测试用）。没有安静区返回 null。 */
function sceneQuietRows() {
  if (!SCENE.quiet || !SCENE.quiet.zone) return null;
  return { r0: Math.floor(ROWS * SCENE.quiet.zone.r0),
           r1: Math.ceil(ROWS * SCENE.quiet.zone.r1) - 1 };
}

/* 走道判定。参数从当前场景读，教室是 6/2/5/3 —— 与重构前逐字一致。 */
function isAisle(c, r) {
  var A = SCENE.aisle;
  return (c % A.colMod === A.colOff) || (r % A.rowMod === A.rowOff);
}

/* ---------- 食堂热门位（手册：食堂「随机刷新热门位置」） ----------
 * ⚠️ 自带一条**独立 RNG 流**（和 evRand / taskRand 一个道理），绝不借 Math.random ——
 *    否则会打乱整局 NPC 走位，「原有功能不损坏」就再也证明不了。
 * 教室 hot 是 null → hotReset / updateSceneHot 第一行就返回，零消耗、对整局零影响。 */
var hotCells = [];            /* [[c,r],...] 当前热门位 */
var hotTimer = 0;             /* 距下次刷新还有几秒 */
var hotSeed = 1;
var hotRoundSeq = 0;
var HOT_SEED_OVERRIDE = null; /* 测试用：钉死种子让热门位可复现 */
function hotRand() {
  hotSeed = (hotSeed * 1664525 + 1013904223) >>> 0;
  return hotSeed / 4294967296;
}
function hotReset() {
  hotRoundSeq++;
  if (HOT_SEED_OVERRIDE) hotSeed = HOT_SEED_OVERRIDE >>> 0;
  else {
    hotSeed = ((Date.now() & 0x7fffffff) ^ (hotRoundSeq * 40503)) >>> 0;
    if (!hotSeed) hotSeed = 1;
  }
  hotCells = [];
  hotTimer = SCENE.hot ? SCENE.hot.every : 0;
}
function isHotCell(c, r) {
  for (var i = 0; i < hotCells.length; i++) {
    if (hotCells[i][0] === c && hotCells[i][1] === r) return true;
  }
  return false;
}
function hotClear(c, r) {
  for (var i = 0; i < hotCells.length; i++) {
    if (hotCells[i][0] === c && hotCells[i][1] === r) { hotCells.splice(i, 1); return; }
  }
}
function updateSceneHot(dt) {
  if (!SCENE.hot) return;
  hotTimer -= dt;
  if (hotTimer > 0) return;
  hotTimer = SCENE.hot.every;
  /* 挑 count 个「非走道」的格子当热门位（独立 RNG，重复就重掷，guard 兜底防死循环）
   *
   * 第七阶段起食堂有了「热门档口」这个概念 —— 热门位就只长在档口那一段里。
   * 满地图乱刷的话，「档口」三个字就没有意义了；而且把四个热门位挤在一小片区域里，
   * 才真的会出现「多人竞争同一个档口」的场面。
   * 抽样范围变了 → hotRand 的消耗变了，但 hotRand 是**独立流**，
   * 跟 Math.random 一点关系都没有，所以整局随机序列照旧。 */
  var stall = dineOn();
  var picked = [], guard = 0, c, r, i, dup;
  while (picked.length < SCENE.hot.count && guard++ < 400) {
    if (stall) {
      c = 1 + Math.floor(hotRand() * dineStallColMax());
      r = dineFastRowMax() + 1 +
        Math.floor(hotRand() * Math.max(1, dineBottomRowMin() - dineFastRowMax() - 1));
    } else {
      c = 1 + Math.floor(hotRand() * (COLS - 2));
      r = 1 + Math.floor(hotRand() * (ROWS - 2));
    }
    if (isAisle(c, r)) continue;
    if (grid[I(c, r)].owner) continue;      /* 已被占的格子当热门位没意义 */
    dup = false;
    for (i = 0; i < picked.length; i++) {
      if (picked[i][0] === c && picked[i][1] === r) { dup = true; break; }
    }
    if (dup) continue;
    picked.push([c, r]);
  }
  hotCells = picked;
}

function configureLayout(compact) {
  COMPACT = !!compact;
  if (COMPACT) {
    /* 紧凑版：格子更少更大，整体画布更小 —— 手机缩放后 UI 才不会糊成一片。
       座位数保持 200 左右，否则一局撑不到 2 分钟。 */
    COLS = 23; ROWS = 13; TILE = 28;
    WALL_L = 24; WALL_R = 24; WALL_T = 84; WALL_B = 20;
  } else {
    COLS = 27; ROWS = 17; TILE = 36;
    WALL_L = 34; WALL_R = 34; WALL_T = 104; WALL_B = 26;
  }
  CW = WALL_L + COLS * TILE + WALL_R;
  CH = WALL_T + ROWS * TILE + WALL_B;
  GX = WALL_L; GY = WALL_T;
  DECO = COMPACT ? 0.8 : 1;      /* 墙上装饰的缩放系数 */
  /* 把版式同步到 DOM 上：CSS 里有一批「紧凑版专用」的规则（结算卡瘦身等），
     靠 #stage.compact 选中。手机上必须生效，否则 692×468 的画布装不下结算卡。 */
  if (stage && stage.classList) stage.classList.toggle('compact', COMPACT);
  buildItemSprites();
}

/* 占座物品的 emoji 预渲染成小图。
 * 每帧有上百个已占座位，直接 fillText 画彩色 emoji 很吃性能（字形整形 + 彩色位图），
 * 预渲染成贴图后只剩一次 drawImage，手机上也稳。 */
var itemSprites = {};
function buildItemSprites() {
  itemSprites = {};
  if (!document.createElement) return;
  var size = Math.ceil(S36(18));
  var list = allItems();
  for (var i = 0; i < list.length; i++) {
    var it = list[i];
    var cv;
    try { cv = document.createElement('canvas'); } catch (e) { continue; }
    if (!cv || !cv.getContext) continue;
    cv.width = Math.max(1, Math.round(size * DPR));
    cv.height = Math.max(1, Math.round(size * DPR));
    var g = cv.getContext('2d');
    if (!g) continue;
    if (g.setTransform) g.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (g.clearRect) g.clearRect(0, 0, size, size);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = emojiFont(FS('ico'));
    g.fillText(it, size / 2, size / 2 + 1);
    itemSprites[it] = { canvas: cv, size: size };
  }
}

/* 把按 36px 格子设计的尺寸换算到当前格子大小 */
function S36(v) { return v * TILE / 36; }

/* 小屏判定：视口较小时切紧凑版，否则手机上字太小、格子看不清 */
function shouldUseCompact() {
  var vp = viewportSize();
  var shortSide = Math.min(vp.w, vp.h);
  return shortSide < 620;
}

/* V1.5 起单局压缩到 90 秒：180 秒在「事件 + 任务」加进来之后节奏太拖，
 * 手册验收要的「单局 3 分钟左右」按现在的内容密度已经不合适。
 * 压缩之后所有随时间推进的节奏都要跟着收紧（NPC 提速曲线、事件间隔）。 */
var GAME_TIME = 90;           /* 一局 1 分半 */
var PLAYER_STEP_MS = 130;     /* 按住方向键的步进间隔 */
/* V1.6 第九阶段（手感修复）「首次长按延迟」：
 * 新按下的方向立刻走一格，之后**先等这么久**才开始按 PLAYER_STEP_MS 连走。
 *
 * 为什么需要它：没有这一段延迟时，「按一下」和「按住」在代码里完全没有区别 ——
 * 按下的第一帧走一格，130ms 后再走一格。而人手敲一下方向键通常按住 150~260ms
 * （测出来：150ms 就已经走两格），于是「按一次」被系统判成「按住」，变成走两格。
 *
 * 280ms 这个值是按「人手」定的，不是按游戏速度定的，所以**不随角色 / 场景 / 冲刺缩放**：
 * 冲刺只该让**连走**更快，不该让「按一下」变得更敏感。 */
var KEY_HOLD_DELAY_MS = 280;
/* 总开关（v16SetV15() 会关掉 → 回到「按下即连走」的老手感，V1.5 基线才继续有效）。
 * 关掉时只是把首次延迟去掉，连走间隔仍由 actorStepMs 决定，随机流一格不动。 */
var KEY_DAS_ON = true;
var COMBO_WINDOW = 2600;      /* 连续占座判定窗口 */
var COMBO_STEP = 4;           /* 每级连击的额外分 */
var NPC_BASE_STEP = 1500;     /* NPC 初始步进间隔，随时间加快 */
var NPC_MIN_STEP = 820;
var NPC_RAMP_SEC = 50;        /* 多少秒后 NPC 达到最快（原来 100 秒，一局 90 秒就永远到不了） */
/* 紧凑版教室小，NPC 再按原速抢座会瞬间抢光，所以整体放慢 */
function npcPace() { return COMPACT ? 1.4 : 1; }

function TX(c) { return GX + c * TILE; }
function TY(r) { return GY + r * TILE; }
function CX(c) { return GX + c * TILE + TILE / 2; }
function CY(r) { return GY + r * TILE + TILE / 2; }
function I(c, r) { return r * COLS + c; }
function inB(c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function rand(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }
function shuffle(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = rand(i + 1), t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

var DIRS = [
  { dx: 0, dy: -1, n: 'up' },
  { dx: 1, dy: 0, n: 'right' },
  { dx: 0, dy: 1, n: 'down' },
  { dx: -1, dy: 0, n: 'left' }
];

/* ---------- 座位类型 ---------- */
var SEAT = {
  normal:  { label: '普通座位',   score: 10,  icon: '',      toast: '',                       desk: '#FFF3D4', edge: '#E6CE96', good: true },
  gold:    { label: '黄金后排',   score: 100, icon: '👑',    toast: '黄金后排！摸鱼圣地！',    desk: '#FFE9A8', edge: '#D9A400', good: true },
  plug:    { label: '插座位',     score: 50,  icon: '🔌',    toast: '电量自由！',              desk: '#D9EFFF', edge: '#5FA8DC', good: true },
  door:    { label: '靠门位',     score: 60,  icon: '🚪',    toast: '下课第一时间跑路。',      desk: '#FFE0D0', edge: '#E08A5A', good: true },
  ac:      { label: '空调位',     score: 40,  icon: '❄️',    toast: '这个夏天有救了。',        desk: '#E2F6FF', edge: '#6FC3DE', good: true },
  teacher: { label: '老师眼皮底下', score: -30, icon: '👨‍🏫', toast: '恭喜获得老师 4K 超清注视。', desk: '#FFD9D9', edge: '#E05A5A', good: false },
  /* ---- V2 第四节：特殊座位升级（V2_SEATS_ON 关闭时这两类不会被摆出来） ----
   * king  ：全场唯一的最高分座位，制造一个「所有人都会去抢」的焦点。
   * couple：成对出现的两格，两格都占下才有额外奖励（见 COUPLE_BONUS）。 */
  king:    { label: '王者后排',   score: 300, icon: '🏆',    toast: '全场唯一的王座！',        desk: '#FFDF7A', edge: '#B8860B', good: true },
  couple:  { label: '情侣座',     score: 80,  icon: '💞',    toast: '成双成对才有加成。',      desk: '#FFD9EC', edge: '#E06AA8', good: true },
  /* ---- V36 下一阶段 阶段 5：中央区（2026-10-18） ----
   * 为什么需要它：v36 的高价值座位**全在四条边上**（黄金后排在最底一排、靠门位在右下角、
   * 插座位贴左右墙、空调位在左上角），地图正中间全是 10 分普通座 ——
   * 双人开局两人虽然离得近，但中间没有值得抢的东西。
   * 分值刻意取 60（= 靠门位）：比普通座高 6 倍，但仍然低于黄金后排 100，
   * 这样「中心」是稳定收益、不是唯一目标，不至于把黄金后排和任务边缘化。 */
  /* ⚠️ toast 里**不能出现场景名**（教室 / 图书馆 / 食堂）——
     这个座位三类场景都会摆，文案体检会把「教室里出现食堂词」判成串场（2026-10-18 栽过一次）。 */
  center:  { label: '中央区',     score: 60,  icon: '🎯',    toast: '正中央的位置，谁都想坐。', desk: '#E8DEFF', edge: '#7B5BD6', good: true }
};

/* ==========================================================
 * V2 第四、五节总开关
 * ----------------------------------------------------------
 * 第四节「特殊座位升级」和第五节「NPC 升级」都会改变**地图骨架**与**NPC 走位**，
 * 也就是会改掉指纹回归的 core / grid 哈希。所以它们整体挂在这个开关下面：
 *   - `指纹回归.js`（V1 档）与 `--events` 档都把它关掉 → 那两份基线继续有效，
 *     证明「V1 与 V1.5 的行为一点没动」；
 *   - 新增的 `--v2` 档打开它 → 另存一份基线，证明新系统本身也是可复现的。
 * 默认 true，也就是玩家拿到的线上版本是开着 V2 内容的。 */
var V2_SEATS_ON = true;

/* 黄金插座区：每 PLUG_TICK 秒结算一次，每个已占插座位产出 PLUG_TICK_SCORE 分。 */
var PLUG_TICK = 6;
var PLUG_TICK_SCORE = 20;
/* 情侣座：成对占下的额外奖励。 */
var COUPLE_BONUS = 150;

/* ---------- 占座物品 ---------- */
var ITEMS = ['🎒', '📚', '🧋', '🧥', '💻', '✏️', '🥤', '📖', '🍩', '🎧'];

/* ---------- 玩家 / NPC 配色 ---------- */
var OWN = {
  player: { body: '#FF8A5B', body2: '#E85D2E', edge: '#A93C14', desk: '#FFE2D4', item: '#FFF8F2' },
  /* 2P：青色，和 1P 的橙、学霸的蓝都拉得开 */
  p2:     { body: '#2EC4B6', body2: '#1B9E92', edge: '#0B6B62', desk: '#D4F3EF', item: '#F2FCFA' },
  n1:     { body: '#6FB6FF', body2: '#3D86E0', edge: '#1F5B9E', desk: '#DCEBFF', item: '#F3F9FF' },
  n2:     { body: '#FFC94D', body2: '#E0A200', edge: '#9E7400', desk: '#FFF0CB', item: '#FFFBEF' },
  n3:     { body: '#B79BFF', body2: '#8B6BF0', edge: '#5A3FB0', desk: '#E7E0FF', item: '#F7F3FF' }
};

var PAL = {
  paper: '#FDF4E3',
  wall: '#F6E9CF', wallLine: '#DFCBA3',
  board: '#2F5D50', boardEdge: '#8A6A3E',
  chair: '#E8D0A2', chairEdge: '#CBAE7C',
  desk: '#FFF3D4', deskLine: '#D9BC80',
  ink: '#2E2A26', ink2: '#6B6152'
};
/* 基准调色板 = 教室那份。切场景时 applyScenePalette() 先把 PAL 还原成基准，
   再叠加 SCENE.pal 的覆盖项 —— 于是「教室」天然等于重构前逐字一致。
 * ⚠️ 场景覆盖项只能用上面已有的键（不认识的新键会在切场景时残留）。
 * ⚠️ 不要覆盖 paper：NPC 淡化配色 OWN_DIM 是加载时按 PAL.paper 算好的常量，
 *    换掉 paper 会让 NPC 的降饱和基准和场景对不上（而且那是加载期算的，改了也不生效）。 */
var PAL_BASE = {};
(function () { for (var k in PAL) PAL_BASE[k] = PAL[k]; })();

function applyScenePalette() {
  var k, o = SCENE.pal;
  for (k in PAL_BASE) PAL[k] = PAL_BASE[k];
  if (o) for (k in o) if (o[k]) PAL[k] = o[k];
}

/* ---------- V1.5 视觉层级：玩家高亮、NPC 退到背景 ----------
 * 手法是「降饱和」而不是「降透明度」：NPC 半透明会和桌面糊在一起，
 * 向教室纸色混合则保留轮廓，但整体亮度、彩度都压下去，
 * 玩家那边保持原配色 + 更强的描边光晕，一眼就能分出主次。 */
function hexToRgb(h) {
  h = String(h).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mixHex(a, b, t) {
  var A = hexToRgb(a), B = hexToRgb(b);
  var r = Math.round(A[0] + (B[0] - A[0]) * t);
  var g = Math.round(A[1] + (B[1] - A[1]) * t);
  var bl = Math.round(A[2] + (B[2] - A[2]) * t);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
}
/* 十六进制 + 透明度 → rgba 串（canvas 里 alpha 走 globalAlpha 会污染整段绘制，
 * 所以渐变里需要带 alpha 的颜色时用这个） */
function hexA(h, a) {
  var c = hexToRgb(h);
  return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}

/* 人类玩家的光环配色（手册指定「黄色/蓝色圆环」）：
 * 1P 金黄 + 蓝，2P 青 + 亮蓝，两人同屏时也能分清。 */
var AURA = [
  { ring: '#FFC93C', ring2: '#4D96FF', glow: '#FFE9A8' },
  { ring: '#2EC4B6', ring2: '#7BD3FF', glow: '#B8F2EC' }
];
/* 人类玩家的占座路线发光色 */
var ROUTE = ['#FFA23C', '#2EC4B6'];

/* 人类玩家的描边光晕强度（比 NPC 亮得多，这是最省钱的「高亮」手段） */
OWN.player.glow = 9;
OWN.p2.glow = 8;

/* NPC 配色：向纸色混合 44%，光晕压到 2.5 —— 视觉权重直接降一档 */
var NPC_MIX = 0.44;
var OWN_DIM = {};
(function () {
  for (var k in OWN) {
    if (k === 'player' || k === 'p2') continue;
    var o = OWN[k];
    OWN_DIM[k] = {
      body: mixHex(o.body, PAL.paper, NPC_MIX),
      body2: mixHex(o.body2, PAL.paper, NPC_MIX),
      edge: mixHex(o.edge, PAL.paper, NPC_MIX * 0.78),
      desk: mixHex(o.desk, PAL.paper, NPC_MIX * 0.62),
      item: mixHex(o.item, PAL.paper, NPC_MIX * 0.45),
      glow: 2.5
    };
  }
})();

/* 某个占座者该用哪套配色：人类玩家高亮，NPC 淡化 */
function ownPalette(id) {
  var a = actorById(id);
  if (a && a.kind === 'ai') return OWN_DIM[id] || OWN[id];
  return OWN[id] || OWN.player;
}

/* 室友（社交达人「求助室友」召来的跟班）的配色。
 * 青绿偏浅，跟 1P 橙、2P 青、三个 NPC 都拉得开，一眼能认出「这是来帮我的」。
 * 室友不进 OWN 表 —— 它永远不占座（占下来都记在玩家头上），ownPalette 用不到它。 */
var OWN_HELPER = {
  body: '#7FE0C8', body2: '#3FBFA3', edge: '#1B7A63',
  desk: '#DFF7F1', item: '#F4FFFC', glow: 5
};
/* 这格属于人类玩家吗（路线发光 / 连接光带只给人类画） */
function isHumanOwner(id) { return id === 'player' || id === 'p2'; }

/* ==========================================================
 * 危险视觉语言（第九阶段 P1-6）
 * ----------------------------------------------------------
 * 文档 §二.3 把「危险」分成 5 类：NPC 占座路线 / 老师视野 / 即将封锁 /
 * 禁止进入 / 可能撞击，要求「统一采用：警示色 + 边缘提示 + 必要的轻微闪烁」。
 *
 * 改之前这 5 类散在 4 个绘制函数里各写各的，最直接的后果是**同一个「危险」
 * 在玩家眼里是两种红**：老师视野用 #E5342B，抢座大战用 #FF4D4D。
 * 玩家没有理由知道这两种红是同义词。
 *
 * 这里把「色 / 描边 / 闪烁」三件事收敛成一张表，四个函数统一引用。
 *
 * ⚠️ 只抽常量、只换色，不改任何绘制顺序与几何 ——
 *    随机序列一个字没动，所以「原有功能不损坏」仍然能被指纹证明。
 * ⚠️ 这张表**只管危险**。「目标提示」（学霸地图的琥珀价签）语义相反，
 *    故意留在 TARGET_STYLE 里用另一个色相 —— 见下面的说明。
 * ========================================================== */
var DANGER_STYLE = {
  /* 唯一的危险红。老师视野 / 可能撞击 / 危险区斜纹 / 撞车文字 / 冲突标记，全部用它 */
  red: '#E5342B',
  /* 同一色的 rgb 三元组：径向渐变与半透明底纹要用，避免手抄色值抄错 */
  redRgb: '229,52,43',
  /* 危险**文字**用的深红。浅色底（米黄墙 / 白描边）上 #E5342B 对比度不够，
     文字要更深一档才读得清 —— 这是「同一套语言里的深浅两档」，不是第二种红 */
  text: '#B71C1C',
  /* 描边宽（写「格子的百分比」而不是 S36 的地方，用这些常量统一） */
  stroke: { thin: 2.4, mid: 3.0, bold: 3.2, heavy: 3.4 },
  /* 闪烁角频率（rad/s）—— 代码里直接写 sin(time * X)，所以这里给的是角频率不是 Hz。
   * 原来各函数自己写了 4 / 4.5 / 11 / 12 / 16 五个值，其中 4 与 4.5、11 与 12
   * 肉眼分不出来，纯属抄来抄去抄歪了。收敛成三档：
   *   zone  大范围危险区（老师视野、前排红斜纹）—— 慢，避免整片画面在闪
   *   near  贴身预警（箭头、目标格虚线圈）—— 快，要抢在玩家松手前被看到
   *   clash 冲突气泡（抢座大战）—— 最快，气泡本身很小，慢了就注意不到
   * 取值刻意沿用原来最常用的那个，视觉上几乎无变化（4.5→4、12→11）。 */
  blink: { zone: 4, near: 11, clash: 16 }
};

/* 目标提示（学霸地图）。**故意不并进 DANGER_STYLE**：
 * 它的语义是「去这里」而不是「别去那里」，两者用同一个色相会直接误导玩家。
 * 文档 §二.3 要统一的是危险语言，不是把所有提示刷成一个颜色。 */
var TARGET_STYLE = {
  ring: '#C77800',   /* 描边：深琥珀，像价签 */
  text: '#8A5A00',   /* 文字：再深一档，压在米黄座位上才读得清 */
  fill: '#FFB020',   /* 阶段8追加：整格底色（只给强标记用） */
  pill: '#8A4B00',   /* 阶段8追加：分值药丸的底 */
  pillText: '#FFFFFF'
};

/* ===== 阶段 8 追加（2026-10-21 用户试玩反馈 R1）=====
 * 反馈原话：「学霸场景在触发技能后的特殊座位还是不明显，触发出特殊座位后要
 *            明显地标记出来特殊座位」。
 *
 * 改前（阶段 7 的 drawMapHints）：只画**一圈 3px 深琥珀描边** + 带白边的「+100」。
 *   在米黄地板上，一圈细线跟座位自身的边线几乎同亮度，23 个标记散在 308 格里
 *   → 玩家扫一眼根本认不出「哪些是特殊座位」。
 * 改后（`SCHOLAR_SEAT_MARK_ON`）：三层叠加，任一层单独失效都还认得出 ——
 *   ① 整格琥珀底（0.18~0.30 脉动）  → 从地板里「亮起来」
 *   ② 白底 + 深琥珀**双层**描边      → 单层深色线对比不够，垫白就跳出来
 *      （这套做法在阶段 8 的学霸预判框上已经验证过一遍）
 *   ③ 深琥珀底 + 白字的**分值药丸**  → 比「描白边的棕字」抓眼，也顺手解决可读性
 * 关掉 → 逐字退回阶段 7 那一圈细线。纯绘制，不读不写模拟状态、不消耗随机数。 */
var SCHOLAR_SEAT_MARK_ON = true;

/* 分值药丸的宽度缓存（键 = `TILE|+100`）。纯绘制用，不参与任何判断。 */
var SEATMARK_W = {};

/* 单个特殊座位的强标记。**只画，不判** —— 「哪些算特殊」仍然由 drawMapHints
 * 用 `SEAT[t.type].score >= 40` 判（铁律 13：判据只有一处）。 */
function drawSpecialSeatMark(g, c, r, def, time) {
  var x0 = TX(c) + S36(2), y0 = TY(r) + S36(2);
  var w = TILE - S36(4);
  var pul = 0.5 + 0.5 * Math.sin(time * 4.0 + (c + r) * 0.35);
  g.save();

  /* ① 整格琥珀底 */
  g.globalAlpha = 0.18 + 0.12 * pul;
  g.fillStyle = TARGET_STYLE.fill;
  rr(g, x0, y0, w, w, S36(8));
  g.fill();

  /* ② 白底 + 深琥珀双层描边 */
  g.globalAlpha = 0.95;
  g.strokeStyle = '#FFFFFF';
  g.lineWidth = S36(6.5);
  rr(g, x0, y0, w, w, S36(8));
  g.stroke();
  g.strokeStyle = TARGET_STYLE.ring;
  g.lineWidth = S36(3.4);
  rr(g, x0, y0, w, w, S36(8));
  g.stroke();

  /* ③ 分值药丸 —— 深琥珀底白字，比原来「描白边的棕字」更抓眼。
     ⚠️ 这里原本还画了「四角角标」，实测**完全无效**：药丸宽度（+300 ≈ 47px）
        已经超过一格（36px），把四个角整个盖住了 —— 1:1 和 2.8 倍放大图里都看不见。
        删掉，别留看不见的绘制。 */
  var label = '+' + def.score;
  g.globalAlpha = 0.97;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = font(FS('sub'), 900);
  /* 宽度缓存：教室里有 23 个特殊座位，每帧 23 次 measureText 是这段的主要开销。
     缓存键里带 TILE —— 紧凑布局与桌面布局的字号不同，宽度不能跨布局复用。 */
  var wkey = (TILE | 0) + '|' + label;
  var tw = SEATMARK_W[wkey];
  if (tw == null) { tw = g.measureText(label).width; SEATMARK_W[wkey] = tw; }
  var ph = S36(15), pw = tw + S36(13);
  var pcx = CX(c), pcy = CY(r) + S36(1);
  g.fillStyle = TARGET_STYLE.pill;
  rr(g, pcx - pw / 2, pcy - ph / 2, pw, ph, ph / 2);
  g.fill();
  g.fillStyle = TARGET_STYLE.pillText;
  g.fillText(label, pcx, pcy + S36(0.5));

  g.restore();
}

/* ==========================================================
 * 字号规范（第九阶段 P1-7，手册 §十五「字体与颜色统一」）
 * ----------------------------------------------------------
 * 手册原文：「检查字号、描边、色彩、标签、按钮，建立简单设计规范。至少明确：
 *   一级标题 / 二级标题 / 普通 HUD / 任务文字 / 警告文字 / 奖励文字。
 *   不要每个模块自己选择字体大小。」
 *
 * 改造前画布侧有 **四套互不相干的字号约定**：
 *   ① `22 * DECO` —— 场景前墙（板书 / 公告栏 / 菜单）
 *   ② `S36(13)`   —— 玩法层（座位道具 / 实体 / 事件）
 *   ③ **裸数字** —— 横幅、气泡、区域标签、抢座大战各自写死了像素（如 23 / 17 / 13 / 12.5）
 *   ④ `f.size`    —— 飘字，50 个调用点自己传了 13 种不同字号（13…26）
 * 其中 ③④ 是真正的病：**它们一个像素都不随布局缩放**，而旁边的板书在紧凑版里缩了 20%。
 * 于是同一个「区域标签」在桌面 12px、在手机还是 12px（而画布只有 692 宽）——
 * 手机上什么都大一圈。这正是「每个模块自己选字号」的直接后果。
 *
 * 现在的规矩：**任何文字都必须从这张表取档**，不许再写裸数字。
 * 表里的数不是像素，是「36 格基准」的设计值，由下面两个访问器换算：
 *   FS(k) = S36(FONT_S[k])   —— 玩法层（座位 / 实体 / 飘字 / 事件 / 引导）
 *   FD(k) = FONT_S[k] * DECO —— 场景装饰层（前墙 / 墙饰 / 道具）
 * 两个访问器对应两套既有的缩放基准，各自沿用，不混用。
 * ⚠️ 新增文字请先在这张表里找档；找不到就**在表里加一档并写清用途**，
 *    不要图省事直接写像素 —— 回归里有「不许出现裸字号」的断言盯着。 */
var FONT_S = {
  /* ---- 手册点名的六档 ---- */
  h1:     22,     /* 一级标题：板书标题、事件横幅主标题 */
  h2:     11.5,   /* 二级标题：板书副标题 */
  hud:    13,     /* 普通 HUD：NPC 气泡、区域标签、场景浮层、座位上的物品 */
  task:   12,     /* 任务文字：场景标签、区域名、食堂菜单行、步进提示、横幅副标题 */
  warn:   17,     /* 警告文字：抢座大战「抢！」、危险飘字 */
  reward: 15,     /* 奖励文字：贴纸主行（禁止占座 / 空位 42 / 自觉排队）、普通奖励飘字 */

  /* ---- 手册没点名、但画布上确实存在的档（集中在这里，别散回各模块）---- */
  sub:    10,     /* 小字说明：贴纸副行、墙上小字、安静值、加分角标、「坐下了」 */
  tag:     9,     /* 小字标签：墙上小物件、座位类型角标、装饰数字（挂钟 12） */
  ico:    13,     /* 道具 / 座位 emoji */
  bigIco: 27,     /* 事件演员 emoji（老师） */
  signL:  21,     /* 装饰大字牌：图书馆「静」（单字，牌面 116×54） */
  signS:  16,     /* 装饰号码牌：食堂「请 078 号」（牌面只有 92×48，再大就出框） */

  /* ---- 飘字的强调阶梯（手册 §十四 要求「普通奖励弹一下、稀有奖励弹跳 + 星点」，
   *      稀有度主要靠**动画**表达，字号只分三档，不要再各自传数）---- */
  fS:     15,     /* 普通奖励飘字 */
  fM:     18,     /* 中等奖励飘字（特殊座位 / 连击） */
  fL:     22      /* 大奖励 / 里程碑飘字（黄金后排、王者后排、事件奖励） */
};

function FS(k) { return S36(FONT_S[k]); }   /* 玩法层：跟着 TILE 缩 */
function FD(k) { return FONT_S[k] * DECO; } /* 场景装饰层：跟着 DECO 缩 */

/* ---------- 文案 ---------- */
var MILESTONES = [
  { n: 10, emoji: '🎒', text: '初具规模', sub: '同学，你一个人坐这么多位置？' },
  { n: 20, emoji: '💺', text: '这排我包了', sub: '这排都是你的？' },
  { n: 30, emoji: '🏆', text: '教室地产大亨', sub: '你是来上课还是来买房的？' },
  { n: 45, emoji: '📜', text: '建议直接把教室过户给你。', sub: '' },
  { n: 60, emoji: '👀', text: '老师看了一眼，以为今天来了三十个人。', sub: '' },
  { n: 80, emoji: '🏙️', text: '半个教室都是你的，但你好像只有一个屁股。', sub: '' }
];

var EVALS = [
  '你不是来上课的，你是来搞房地产的。',
  '半个教室都是你的，但你好像只有一个屁股。',
  '建议下次直接提前一晚上来。',
  '老师看了一眼，以为今天来了三十个人。',
  '占座能力：SSS。',
  '同桌看了一眼，默默把书搬走了。',
  '建议去申请一下这间教室的产权。',
  '这排……确实被你占了。'
];

var SMALL_TIPS = [
  '同学，你一个人坐这么多位置？',
  '这排都是你的？',
  '你是来上课还是来买房的？',
  '建议直接把教室过户给你。',
  '隔壁同学已经开始记你名字了。'
];

/* ---------- 场景化文案（第八阶段） ----------
 * NPC 台词 / 里程碑 / 结算评语 / 小提示 / 座位道具 / 座位名 / 技能名 / 事件横幅
 * 这些文案表原本全是教室口吻，三个场景共用，于是食堂里会冒出「老师」「上课」
 * 「最后一排」「把教室过户给你」这种串味台词。
 *
 * 这里给图书馆和食堂各配一张「说法替换表」，做法是**翻译**而不是换表：
 *
 *   ⚠️ 铁律：绝不能改任何文案数组的**长度**。
 *      pick(arr) 内部是 arr[rand(arr.length)]，长度一变，消耗的随机数次数就变，
 *      整局 NPC 走位立刻重排（见经验手册 §1c）。所以 pick 的输入一个字节都不动，
 *      而是「照常 pick 出原文案，再按场景翻译一遍」：
 *
 *          st(pick(EVALS))
 *
 *      教室那张表是**空表** → st() 查不到就原样返回 → 教室逐字不变，
 *      三档指纹因此全绿（这是「纯增量」的可证前提）。
 *
 * 键 = 原文案本身；值 = 该场景的说法。查不到 → 原样返回。
 * 教室不需要任何条目（它就是原文案的基准）。 */
var SCENE_TEXT = {
  classroom: {},

  library: {
    /* --- NPC 台词 --- */
    '第一排还有位置！': '靠里那排最安静！',
    '前排听得清楚！': '这边灯光好，我先占了！',
    '最后一排是我的！': '最里面那排是我的！',
    '后排才是人待的地方。': '角落里才是人待的地方。',
    '这个位置我预习过！': '这个位置我早就看好了！',
    '下课第一时间跑路。': '闭馆第一时间跑路。',

    /* --- 里程碑 --- */
    '教室地产大亨': '图书馆霸主',
    '同学，你一个人坐这么多位置？': '同学，你一个人占这么多座？',
    '你是来上课还是来买房的？': '你是来自习还是来买房的？',
    '建议直接把教室过户给你。': '建议直接把这一层划给你。',
    '老师看了一眼，以为今天来了三十个人。': '管理员看了一眼，以为今天来了三十个人。',
    '半个教室都是你的，但你好像只有一个屁股。': '半个图书馆都是你的，但你好像只有一个屁股。',

    /* --- 结算评语 --- */
    '你不是来上课的，你是来搞房地产的。': '你不是来自习的，你是来搞房地产的。',
    '同桌看了一眼，默默把书搬走了。': '邻座看了一眼，默默把书搬走了。',
    '建议去申请一下这间教室的产权。': '建议去申请一下这一层的产权。',
    '隔壁同学已经开始记你名字了。': '隔壁那位已经开始记你名字了。',
    '你俩是把教室当自己家了吧。': '你俩是把图书馆当自己家了吧。',
    '后排的战争，前排完全看不懂。': '里面的战争，外面完全看不懂。',
    '这局抢得比食堂开饭还凶。': '这局抢得比期末周还凶。',
    '建议直接去申请两间教室。': '建议直接去申请两个自习室。',
    /* 第九阶段 P1-3：角色评语里唯一带「教室」的一条（社交达人）。 */
    '半个教室都是你朋友帮你占的。': '半个自习区都是你朋友帮你占的。',

    /* --- 事件横幅 / 飘字 --- */
    '老师开始点名！': '管理员查座！',
    '10 秒内跑进绿圈': '10 秒内躲进绿圈',
    '点名 +200': '查座 +200',
    '被老师点名了': '被管理员记名了',
    '-80 被点名了': '-80 被记名了',
    '老师巡视中！': '管理员巡视中！',
    '摸鱼大师！': '静音大师！',
    '老师巡视全程没被发现 +120': '巡视全程没被发现 +120',
    '被老师看见了': '被管理员看见了',
    '老师提前进教室了！': '管理员提前进场了！',
    '前排两排别待着，快往后躲': '最前两排别待着，快往后躲',
    '被老师盯了一路': '被管理员盯了一路',
    '临时换教室！': '临时清场！',
    '同学都去喝奶茶了': '附近的人都去吃饭了',
    '点名了！': '查座了！',
    '上课还有 1 分半': '开馆还有 1 分半',
    '老师视野 +100%': '管理员视野 +100%',
    '老师来了': '管理员来了',
    '点名危机': '查座危机',
    '对手被点名，速度骤降': '对手被记名，速度骤降',
    '老师眼皮底下': '管理员眼皮底下',
    '王者后排': '王者专座',
    '黄金后排': '黄金座位',
    '黄金后排！摸鱼圣地！': '黄金座位！静音宝座！',
    '恭喜获得老师 4K 超清注视。': '恭喜获得管理员 4K 超清注视。'
  },

  canteen: {
    /* --- NPC 台词 --- */
    '第一排还有位置！': '打饭窗口还有位置！',
    '前排听得清楚！': '靠近窗口出餐快！',
    '最后一排是我的！': '最里面那桌是我的！',
    '后排才是人待的地方。': '角落才是人待的地方。',
    '这个位置我预习过！': '这个窗口我最熟！',
    '这排我全要了！': '这桌我全要了！',
    '下课第一时间跑路。': '吃完第一时间跑路。',

    /* --- 里程碑 --- */
    '这排我包了': '这桌我包了',
    '教室地产大亨': '食堂包场王',
    '同学，你一个人坐这么多位置？': '同学，你一个人占这么多位？',
    '这排都是你的？': '这桌都是你的？',
    '你是来上课还是来买房的？': '你是来吃饭还是来买房的？',
    '建议直接把教室过户给你。': '建议直接把这个食堂过户给你。',
    '老师看了一眼，以为今天来了三十个人。': '阿姨看了一眼，以为今天来了三十个人。',
    '半个教室都是你的，但你好像只有一个屁股。': '半个食堂都是你的，但你好像只有一个胃。',

    /* --- 结算评语 --- */
    '你不是来上课的，你是来搞房地产的。': '你不是来吃饭的，你是来搞房地产的。',
    '同桌看了一眼，默默把书搬走了。': '邻桌看了一眼，默默端着盘子走了。',
    '建议去申请一下这间教室的产权。': '建议去申请一下这个食堂的产权。',
    '这排……确实被你占了。': '这桌……确实被你占了。',
    '隔壁同学已经开始记你名字了。': '邻桌已经开始记你名字了。',
    '你俩是把教室当自己家了吧。': '你俩是把食堂当自己家了吧。',
    '后排的战争，前排完全看不懂。': '窗口的战争，角落完全看不懂。',
    '这局抢得比食堂开饭还凶。': '这局抢得比开饭铃还凶。',
    '建议直接去申请两间教室。': '建议直接去申请两个包间。',
    /* 第九阶段 P1-3：角色评语里唯一带「教室」的一条（社交达人）。 */
    '半个教室都是你朋友帮你占的。': '半层食堂都是你朋友帮你占的。',

    /* --- 事件横幅 / 飘字 --- */
    '老师开始点名！': '叫号取餐！',
    '10 秒内跑进绿圈': '10 秒内跑到取餐口',
    '点名 +200': '取餐 +200',
    '被老师点名了': '错过叫号了',
    '-80 被点名了': '-80 错过叫号了',
    '老师巡视中！': '值班的巡视中！',
    '管理员来了！': '收桌的来了！',
    /* V1.6 第二阶段：固定时间表清理的「预告」横幅。
       ⚠️ 2026-10-08 对齐手册 §七 原文（预告主文案改回「管理员来了！」
       —— 与上面的**执行**横幅同名，共用这一条映射）；副文案改成
       「这些座位马上要被清理！」。食堂里管事的是收桌的阿姨，
       不能把「管理员 / 座位」带进来（文案体检查这条）。 */
    '这些座位马上要被清理！': '这些桌子马上要被清理！',
    '摸鱼大师！': '干饭大师！',
    '老师巡视全程没被发现 +120': '巡视全程没被发现 +120',
    '被老师看见了': '被值班的看见了',
    '老师提前进教室了！': '食堂值班的提前来了！',
    '前排两排别待着，快往后躲': '最前两排别待着，快往后躲',
    '被老师盯了一路': '被值班的盯了一路',
    '临时换教室！': '临时清桌！',
    '食堂开饭了！': '第一波人潮来了！',
    '同学们都跑了，趁现在狂抢': '排队的人少了，趁现在狂抢',
    '同学都去喝奶茶了': '附近的人都去排队了',
    '点名了！': '叫号了！',
    '上课还有 1 分半': '开饭还有 1 分半',
    '老师视野 +100%': '阿姨视野 +100%',
    '老师来了': '值班来了',
    '点名危机': '叫号危机',
    '对手被点名，速度骤降': '对手被叫号，速度骤降',
    '老师眼皮底下': '阿姨眼皮底下',
    '王者后排': '王者宝座',
    '黄金后排': '黄金座位',
    '黄金后排！摸鱼圣地！': '黄金座位！干饭宝座！',
    '恭喜获得老师 4K 超清注视。': '恭喜获得阿姨 4K 超清注视。',

    /* --- 座位上的道具：教室是书包课本，食堂换成饭菜餐具 --- */
    '🎒': '🍚', '📚': '🍜', '🧋': '🥢', '🧥': '🍗', '💻': '🍱',
    '✏️': '🥤', '🥤': '🧋', '📖': '🍩', '🍩': '🍎', '🎧': '🥛'
  }
};

/* 把一句原文案翻译成当前场景的说法。查不到（教室、或没配过）→ 原样返回。 */
function st(s) {
  var t = SCENE_TEXT[SCENE.id];
  if (!t) return s;
  var v = t[s];
  return v == null ? s : v;
}

/* 所有场景可能用到的道具 emoji（并集，去重）。预渲染贴图要按它来建，
   否则食堂那套饭菜 emoji 没预热，每帧都得走 fillText 的彩色字形整形。 */
function allItems() {
  var out = ITEMS.slice(), seen = {}, i, k, t;
  for (i = 0; i < out.length; i++) seen[out[i]] = 1;
  for (k in SCENE_TEXT) {
    t = SCENE_TEXT[k];
    for (i = 0; i < ITEMS.length; i++) {
      var v = t[ITEMS[i]];
      if (v && !seen[v]) { seen[v] = 1; out.push(v); }
    }
  }
  return out;
}

/* ---------- DOM 里的场景化文案 ----------
 * 画布上的文案走 st()；但开屏卡 / HUD 计时器 / 图例 / 提示这些是 HTML 节点，
 * 得单独刷。默认 HTML 写的就是教室那套，所以不调这个函数时 = 教室行为。 */
var SCENE_DOM = {
  classroom: { timeLbl: '上课还有 ', tag: '教室抢座',
    sub: '上课还有 1 分半，先抢到后排再说。', legend: '老师眼皮底下',
    hint: '拖动左下角摇杆移动 · 也可以在教室里滑动', count: '距离上课还有……' },
  library: { timeLbl: '开馆还有 ', tag: '图书馆抢座',
    sub: '开馆还有 1 分半，先抢到安静区再说。', legend: '管理员眼皮底下',
    hint: '拖动左下角摇杆移动 · 也可以在图书馆里滑动', count: '距离开馆还有……' },
  canteen: { timeLbl: '开饭还有 ', tag: '食堂抢位',
    sub: '开饭还有 1 分半，先抢到窗口再说。', legend: '阿姨眼皮底下',
    hint: '拖动左下角摇杆移动 · 也可以在食堂里滑动', count: '距离开饭还有……' }
};

function applySceneText() {
  var d = SCENE_DOM[SCENE.id] || SCENE_DOM.classroom;
  var e;
  e = $('hud-time-lbl'); if (e) e.textContent = d.timeLbl;
  e = $('start-tag');    if (e) e.textContent = d.tag;
  e = $('start-sub');    if (e) e.textContent = d.sub;
  e = $('lg-teacher');   if (e) e.textContent = d.legend;
  e = $('hint-touch');   if (e) e.textContent = d.hint;
  e = $('count-title');  if (e) e.textContent = d.count;
  /* 角色卡上的技能说明（title 属性）里写着「老师来了」。
     第一次读到时把原文存下来，之后都从原文重算 —— 免得连切两次场景后
     第二次找不到「老师来了」而改不动。 */
  if (!document.querySelectorAll) return;
  var cards = document.querySelectorAll('.rc-desc'), i, t;
  for (i = 0; i < cards.length; i++) {
    if (!cards[i].getAttribute) continue;
    t = cards[i].getAttribute('title');
    if (t == null) continue;
    if (cards[i].__t0 == null) cards[i].__t0 = t;
    cards[i].setAttribute('title', cards[i].__t0.split('老师来了').join(st('老师来了')));
  }
}

/* ==========================================================
 * 2. DOM
 * ========================================================== */

var $ = function (id) { return document.getElementById(id); };
var canvas = $('game');
var ctx = canvas.getContext('2d');
var stage = $('stage');
var frame = $('frame');

var elHud = $('hud');
var elScore = $('hud-score');
var elScoreBox = $('hud-score-box');
var elSeats = $('hud-seats');
var elCombo = $('hud-combo');
var elComboN = $('hud-combo-n');
var elTime = $('hud-time');
var elTimeWrap = $('hud-time-wrap');
var elBest = $('hud-best');

var elStart = $('screen-start');
var elCount = $('screen-count');
var elCountNum = $('count-num');
var elOver = $('screen-over');
var elOverReason = $('over-reason');
var elStSeats = $('st-seats');
var elStSpecial = $('st-special');
var elStWins = $('st-wins');
var elStBlock = $('st-block');
var elStCombo = $('st-combo');
var elStScore = $('st-score');
var elOverEval = $('over-eval');
var elOverBest = $('over-best');
var elOverTasks = $('over-tasks');
var elOverTitles = $('over-titles');
var elOverAch = $('over-ach');
var elOverHighlight = $('over-highlight');
var elHudTasks = $('hud-tasks');
var elHudTaskList = $('hud-task-list');
var elHudTaskHead = $('hud-task-head');

var btnSound = $('btn-sound');
var btnPause = $('btn-pause');
var btnQuit = $('btn-quit');
var elPause = $('screen-pause');
var elPauseSub = $('pause-sub');
var btnResume = $('btn-resume');
var btnPauseQuit = $('btn-pause-quit');
var btnStart = $('btn-start');
var btnRestart = $('btn-restart');
var btnRestartRole = $('btn-restart-role');
var btnRestartVs = $('btn-restart-vs');

/* 玩法规则面板（V1.6 第九阶段）：开始页右上角那张小贴纸的开关 */
var elRules = $('screen-rules');
var btnRules = $('btn-rules');
var btnRulesClose = $('btn-rules-close');
var btnRulesOk = $('btn-rules-ok');
var elRulesList = $('rules-list');
var elRulesMore = $('rules-more');

/* 双人模式的 HUD 与对战报告 */
var elScore2 = $('hud2-score');
var elScoreBox2 = $('hud2-score-box');
var elSeats2 = $('hud2-seats');
var elCombo2 = $('hud2-combo');
var elComboN2 = $('hud2-combo-n');
var elOverSolo = $('over-solo');
var elOverVs = $('over-versus');
var elVsTitle = $('vs-title');
var elVsEval = $('vs-eval');
var elVsCol1 = $('vs-col-1');
var elVsCol2 = $('vs-col-2');

/* 技能栏。
 * V1.6 第二阶段：每个角色只剩槽位 0 的招牌技能，所以这里只建 1 个按钮/玩家，
 * 第二冷却显示（sk-n-1）整块不再接管 —— index.html 里那两个按钮也一并删掉了。
 * 循环上界用 SKILL_SLOT_COUNT，setV16(false) 时自动回到 2 个。 */
var skillUI = null;

function initSkillUI() {
  skillUI = [];
  for (var n = 1; n <= 2; n++) {
    var pair = [];
    for (var i = 0; i < SKILL_SLOT_COUNT; i++) {
      pair.push({
        root: $('sk-' + n + '-' + i),
        ico: $('sk-' + n + '-' + i + '-ico'),
        cd: $('sk-' + n + '-' + i + '-cd'),
        lastId: undefined, lastCd: -1
      });
    }
    skillUI.push(pair);
  }
}

function syncSkills(a, pi) {
  if (!skillUI || !skillUI[pi]) return;
  var pair = skillUI[pi];
  for (var i = 0; i < SKILL_SLOT_COUNT; i++) {
    var el = pair[i];
    if (!el || !el.root) continue;
    var id = a.skills[i];
    var def = id ? SKILLS[id] : null;
    if (el.lastId !== id) {
      el.lastId = id;
      el.ico.textContent = def ? def.emoji : '—';
      el.root.title = def ? (st(def.name) + '：' + st(def.toast)) : '';
    }
    var left = a.skillCd[i];
    var sec = left > 0 ? Math.ceil(left) : 0;
    if (el.lastCd !== sec) {
      el.lastCd = sec;
      el.cd.textContent = sec ? String(sec) : '';
      if (el.root.classList) el.root.classList.toggle('cooling', sec > 0);
    }
  }
}

/* 模式与角色选择的界面同步 */
function setVsOnline(on) {
  NET.vsOnline = !!on;
  var a = $('btn-vs-local'), b = $('btn-vs-online');
  if (a && a.classList) a.classList.toggle('on', !on);
  if (b && b.classList) b.classList.toggle('on', !!on);
  var area = document.getElementById('invite-area');
  if (area && area.classList) area.classList.toggle('hidden', !on);
  var st = $('btn-start');
  if (st) st.textContent = on ? '创建房间并等待好友' : '冲进去抢座！';
  /* 角色行只留 2P 那行有意义时展示；单人时两块都隐藏 */
  var sub = document.getElementById('vs-sub');
  var rl2 = document.getElementById('role-line-2');
  if (!isVersus()) {
    if (sub && sub.classList) sub.classList.add('hidden');
    if (area && area.classList) area.classList.add('hidden');
    if (rl2 && rl2.classList) rl2.classList.add('hidden');
  }
}

function syncModeUI() {
  var sub = document.getElementById('vs-sub');
  if (sub && sub.classList) sub.classList.toggle('hidden', !isVersus());
  if (!isVersus()) {
    NET.vsOnline = false;
    var area = document.getElementById('invite-area');
    if (area && area.classList) area.classList.add('hidden');
  }
  var b1 = $('btn-mode-solo'), b2 = $('btn-mode-versus');
  if (b1 && b1.classList) b1.classList.toggle('on', !isVersus());
  if (b2 && b2.classList) b2.classList.toggle('on', isVersus());
  var l2 = $('role-line-2');
  if (l2 && l2.classList) l2.classList.toggle('hidden', !isVersus());
  /* 局部放大只给单人：双人模式隐藏开关并强制关闭，避免共屏时只跟一个人 */
  var zr = document.getElementById('zoom-row');
  if (zr && zr.classList) zr.classList.toggle('hidden', isVersus());
  if (isVersus()) {
    ZOOM_ON = false;
    var cz = document.getElementById('chk-zoom');
    if (cz) cz.checked = false;
  }
  syncRoleUI();
}

/* 场景选择按钮的选中态（开始页）。切换场景由 sceneSet 完成（它会重开演示局）。 */
function syncSceneUI() {
  var ids = ['classroom', 'library', 'canteen'];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById('btn-scene-' + ids[i]);
    if (el && el.classList) el.classList.toggle('on', SCENE.id === ids[i]);
  }
}

function syncRoleUI() {
  for (var p = 1; p <= 2; p++) {
    for (var r = 0; r < ROLES.length; r++) {
      var el = $('role-' + p + '-' + ROLES[r].id);
      if (el && el.classList) el.classList.toggle('on', rolePick[p - 1] === ROLES[r].id);
    }
  }
}

var DPR = Math.min(window.devicePixelRatio || 1, 2);
var bg = document.createElement('canvas');
var bgx = bg.getContext('2d');

/* ==========================================================
 * 3. 运行时状态
 * ========================================================== */

var state = 'start';          /* start | count | play | over */
var demo = true;
/* 暂停（2026-10-10）。⚠️ 刻意**不**并进 state —— state 是「这一局走到哪一步」，
 * 暂停是「这一步先停住」，两者正交。并进去就要改所有 `state === 'play'` 的判断，
 * 风险远大于收益。它只被 update() 读一次（算完 dt、算完演出之后立刻 return）。 */
var PAUSED = false;

var grid = [];
var actors = [];              /* 所有占座者（玩家 + NPC）。V2 双人模式往这里加人即可 */
var player = null;            /* actors[0]，V1 的单一入口 */
var npcs = [];                /* actors 中 kind === 'ai' 的那些 */
var plugCells = [];

var floats = [];
var parts = [];
var banners = [];
var bubbles = [];             /* NPC 头顶对话气泡 */

/* 计分项（score / seatCount / specialCount / winCount / combo / maxCombo /
 * lastClaimAt / milestoneIdx）已全部搬到 Actor 上，见 makeActor。
 * 这里只留「一局一份」的全局计时与演出状态。 */
var elapsed = 0, timeLeft = GAME_TIME;
var shakeT = 0, shakeMag = 0, shakeDur = 1;
var countT = 0, lastCountShown = null, overDelay = 0;

/* ---------- 局部放大（跟随自己）----------
 * 纯渲染层相机：只在「单人 + 游玩中」生效，把画布当镜头跟随 humans[0]。
 * 双人同屏不启用——一台设备两人共屏，跟一个人等于剥夺另一个人的视野，
 * 而且会毁掉「看对手路线来封堵」的核心策略。
 * 用 ZOOM_ON 总开关包住，默认关；关掉时 render() 行为与旧版逐字一致、
 * 不消耗任何随机数、不影响指纹可复现性。 */
var ZOOM_ON = false;        /* 局部放大总开关（开始页勾选） */
var ZOOM = 1.6;             /* 放大倍率 */
var camX = 0, camY = 0;     /* 相机视口左上角（世界坐标） */
var camReady = false;       /* 一局开局先 snap 到玩家，避免从上一局位置缓动过来 */
var bestScore = 0;
var tipTimer = 6, eggTimer = 0, alertTimer = 14;
/* V1.5：周期性提示不再弹横幅，改成在地图上给一个空着的特殊座位打「看这里」光环 */
var hintTile = -1, hintT = 0;
/* 校园梗的展示计数：消耗照旧，但每 3 次才真正画一次，视觉频率降到 1/3 */
var tipN = 0;
var bumpT = 0;

/* ---------- V1.5 第二阶段：校园事件系统 ----------
 * 手册：「让每局发生不同事情」。这里是事件管理器的「一局一份」状态。
 *
 * 最关键的一条约束：事件系统自带一条随机流（evRand），绝不碰 Math.random()。
 * 因为 Math.random() 的调用顺序决定整局 NPC 的走位 —— 事件如果共用它，
 * 加一个事件就会把所有人的路线全部挪位，「原有功能不损坏」就无从验证。
 * 自带流之后，事件只是往教室里「加东西」，不改变既有的随机序列。 */
var EVENTS_ON = true;       /* 总开关：回归测试关掉它，验证 V1 核心循环逐帧不变 */
/* V2 第六节：4 个新的校园事件（老师提前进教室 / 临时换教室 / 食堂开饭 / 期末周狂暴）。
 * 单独再给一条开关，原因和 V2_SEATS_ON 一样 —— 把事件加进池子会**改变 evPickKind
 * 的候选池大小**，也就是改变 evRand 的消耗顺序，整局事件序列都会重排。
 * 关掉时事件池退回 V1.5 的 4 个，`--events` 档的指纹就能保持逐字不变。 */
var V2_EVENTS_ON = true;
var EV_SEED_OVERRIDE = 0;   /* 测试用固定种子，保证事件流可复现 */
var evSeed = 1, evRoundSeq = 0;
var evTimer = 0;            /* 距下一个事件还有几秒 */
var evActive = null;        /* 正在跑的事件 { kind, t, max, ... } */
var evLastKind = '';        /* 上一个事件的种类，避免连着来同一个 */
var evDone = 0;             /* 本局已触发的事件数 */
var evFx = [];              /* 一次性特效（管理员清理的涟漪）{ x, y, t, max } */

function evRand() {
  evSeed = (evSeed * 1664525 + 1013904223) >>> 0;
  return evSeed / 4294967296;
}
function evInt(n) { return Math.floor(evRand() * n); }

function evReset() {
  evRoundSeq++;
  if (EV_SEED_OVERRIDE) evSeed = EV_SEED_OVERRIDE >>> 0;
  else {
    evSeed = ((Date.now() & 0x7fffffff) ^ (evRoundSeq * 40503)) >>> 0;
    if (!evSeed) evSeed = 1;
  }
  evTimer = 6 + evRand() * 5;       /* 2026-09-19 调高频率：第一个事件第 6~11 秒（原为 10~16 秒）。
                                     * 单局只有 90 秒，早一点开事件让整局更热闹 */
  evActive = null; evLastKind = ''; evDone = 0; evFx = [];
  evCleanReset();                   /* V1.6：固定时间表的清理计划也随局清空 */
  /* V2 第六节：把事件留下的减速 / 狂暴状态一并清掉，
     否则重开一局时同学们还带着上一局的加速或减速。 */
  for (var i = 0; i < actors.length; i++) { actors[i].rage = 0; }
}

/* ==========================================================
 * 6b. V1.6《基础玩法验证版》第二阶段：收敛总开关
 * ----------------------------------------------------------
 * 第二阶段要把玩法收回到一条主线：一局只做一个任务、事件只剩固定两次
 * 管理员清理、每个角色只剩一个招牌技能。
 *
 * ⚠️ 这一组开关**只做「暂停」，不做「删除」**。把七个值全部置回 V1.5 的取值，
 *    事件 / 任务 / 技能三个系统就逐字回到改造前的行为。这不是口头承诺：
 *    指纹回归的 `--events` / `--v2` 两档在开跑前会调 `setV16(false)`，
 *    它们必须继续命中 V1.6 之前存下的老基线 —— 「暂停 ≠ 删掉」因此可被证明。
 *
 * 为什么不干脆把数组改短：
 *   ① `TASK_DEFS` / `EV_KINDS` 的**候选池长度**决定 taskRand / evRand 的消耗次数，
 *      改长度 = 整局重排（经验手册 §1c 那条铁律）。留一个开关，老基线才继续有效。
 *   ② 第三阶段还要按文档验收，随时可能要调回某个机制。
 * ========================================================== */
var EV_SCHED_ON = false;      /* 随机事件排程。false = 只按 EV_CLEAN_AT 的固定时间表跑清理 */
var EV_ONLY_CLEAN = true;     /* 事件池只留管理员清理（点名/巡视/换教室/速度变化暂停，实现保留） */
var EV_CLEAN_SKIP_FEET = true;/* 清理时跳过「玩家正踩着」的那一格（手册 §七 / §十七 技术验收） */
var TASK_COUNT = 1;           /* 单人每局抽几个任务。1 = 一局只有一个固定任务 */
var TASK_REFILL_ON = false;   /* 任务完成后是否补新任务 */
var TASK_EXTRA_ON = false;    /* 图书馆讨论区是否追加额外任务 */
var TASK_MILKFISH_ON = false; /* 教室池是否保留《低调摸鱼》（老师巡视暂停 → 它的前提没了） */
var SKILL_SLOT_COUNT = 1;     /* 每个角色可用几个技能。1 = 只留槽位 0 的招牌技能 */
/* 图书馆三处「设定与实现不一致」的修复（2026-10-03，外部评审 F 条）：
 *   ① 安静区实际是**加速**（该慢反快）  ② 持续走动时安静值反而**回血**（该掉不掉）
 *   ③ 被管理员驱赶后设了 freeze 却**从不检查**（该罚不罚）
 * 三处都只作用于图书馆，而默认场景是教室（lib 为 null）→ 四档指纹零影响。
 * 关掉它 = 逐字回到修复前的旧行为，用来做 A/B 对照。 */
var LIB_FIX_ON = true;

/* ---------- 外部评审《v33 基础玩法规则调整方案》A / B / C 三条（2026-10-04） ----------
 * 总纲（文档原文）：**前面没抢到好座位，后面还有没有机会？继续行动能不能比停着等收益
 * 更有用？失误以后还有没有继续玩的动力？** 三条改的是同一件事：让「继续抢座」一直有意义。
 *   A 特殊座位也纳入定时清理 —— 后半局重新有值得争的目标（不再一占永逸）
 *   B 暂停插座持续自动产分   —— 得分改由「继续抢座」产生（不能开局占一个就坐享其成）
 *   C 插座任务按「本局累计抢到的不同插座」计 —— 清理不倒扣、反复抢不重复；
 *     并且**暂时没有补救办法的任务不再被抽到**（详见 taskHasRemedy）
 * ⚠️ 三个开关全关 = 逐字回到 v33 行为，`--events` / `--v2` 老基线可比（铁律 3）。 */
var EV_CLEAN_SPECIAL_ON = true;   /* A：定时清理也清掉一部分**已被占领的特殊座位** */
var EV_CLEAN_SPECIAL_RATIO = 0.34;/* A：被占特殊座位里清掉多大比例（至少 1 个；数值待调） */
var PLUG_TICK_ON = false;         /* B：插座持续自动产分。false = 暂停（得分只来自抢座） */
var TASK_PLUG_CUMUL_ON = true;    /* C：插座任务按累计「不同插座」计 + 无可补救的任务不抽 */

/* ---------- 外部评审 D 条：单人和双人的基础碰撞规则尽量一致（2026-10-04） ----------
 * 文档原文：
 *   现有机制：撞到他人的占座，单人模式会立刻结束，双人模式则是受罚后继续。
 *   造成的问题：同一个动作在两种模式里后果不同……单人的连续操作也容易被一次失误打断。
 *   建议修改：**默认单人也改成碰撞后扣分、连击清零，等待后回到可以正常离开的安全走道
 *             继续，比赛计时不暂停。**自己的座位可以经过，墙和对方身体只挡路，
 *             他人的占座触发碰撞惩罚；角色技能允许穿越时按技能规则处理。
 *   修改理由：单人可以用来熟悉操作、挑战自己的成绩……失误有损失，但还有追回来的机会。
 *
 * 实现口径（与双人**完全同一套** `penalizePlayer` → `respawnPlayer`）：
 *   扣 `PENALTY_SCORE` 分（最低 0）→ 连击清零 → 复位等待 `PENALTY_WAIT` 秒
 *   （期间不接受移动输入）→ 由 `findSafeRespawn` **确定性**找一格「有活路的安全走道」落地
 *   → 落地后 `PENALTY_INVULN` 秒保护期。全程零 `Math.random`，`elapsed` 照常推进
 *   （`timeLeft = GAME_TIME - elapsed`）⇒ **计时不暂停**。
 *
 * ⚠️ 影响面：单人的两条提前结束路径（`'npc'` 撞占座 / `'blocked'` 被围死）都会消失，
 *    整局只可能由「上课铃」结束。所以 `endGame('npc')` 在本开关关掉时才可达 ——
 *    **代码保留、不删**（铁律 3）。 */
var SOLO_PENALTY_ON = true;       /* D：单人失误改成扣分 + 复位，不再一撞就出局 */

/* E：负分座位**纯惩罚**（2026-10-09，外部评审「负分座位不要因为加成反而变成奖励」）。
 * 三条一起生效，全部是纯算术 / 纯条件判断，**零随机消耗**：
 *   ① 不加连击、也不刷新连击（`combo` / `lastClaimAt` 不动）
 *   ② 不吃连击奖励（`bonus` 置 0）
 *   ③ 不吃区域加成（图书馆安静区 / 食堂饭菜等，对负分座直接短路）
 * 免罚角色（摸鱼大师）只免「扣分」本身，**不因此获得正收益** —— `base` 归零后 `gain` 也是 0。
 * 关掉 = 逐字回到旧行为（负分座照样叠满连击与区域加成），老基线照旧。 */
var NEG_SEAT_PURE_ON = true;

/* ===== V36 下一阶段 · 阶段 1：两个独立 bug 的修复（2026-10-15） =====
 * 1B `COMBO_CLOCK_FIX_ON` —— 暂停不再把连击清零。
 *   根因：连击超时读的是**挂钟** `performance.now()`，而暂停期间挂钟照走 ——
 *   暂停 5 秒回来，2.6 秒的连击窗口早就过期，`combo` 被清零（阶段 0 已实测复现）。
 *   改法：**读写两侧都保持裸挂钟**，只在「恢复」那一刻把暂停时长补给每个演员的
 *   `lastClaimAt`（见 setPaused）—— 连击窗口于是不含暂停时间。
 *   `lastClaimAt` 的量纲**不变**（测试台到处在种这个字段，换量纲会与它们脱钩）。
 *   ⚠️ 关掉时这段整段不进 → 逐字回到 v36（暂停超过 2.6 秒后连击被清零）。
 * 1C `TASK_PLUG_REMEDY_ON` —— 插座任务的**保底补救机会**。
 *   根因：任务要 3 个「本局累计抢到的不同插座」，插座位一旦被 NPC 占满，玩家抢不回来
 *   （规则不允许抢别人的座）→ 任务永久无解；而固定清理是**全图随机**，不保证放到插座位。
 *   改法：清理时若「充电自由」还在进行且玩家还没抢够，就从**已洗好的**特殊座位池里
 *   补进最多 `TASK_PLUG_REMEDY_MIN` 个「玩家没抢到过」的插座位（纯数组读，零随机消耗）。
 *   ⚠️ 关掉时这段整段不进 —— 清理名单与 v36 逐字相同。
 * 两个开关都进收敛组：v16SetV15() 关掉 → `--events` / `--v2` 两档的老基线继续有效。 */
var COMBO_CLOCK_FIX_ON = true;
var TASK_PLUG_REMEDY_ON = true;
var TASK_PLUG_REMEDY_MIN = 2;

/* ===== V36 下一阶段 · 阶段 2：管理员清理改成「集中区域清理」（2026-10-17） =====
 * 文档原文：「当前零散清理容易让玩家继续各走各的。改成清理一组桌子或一片连续座区，
 *   制造明确的下一轮争抢中心。」规则四条：
 *   ① 保留现有两次清理（30 / 60 秒），不改时间与次数；
 *   ② 每次清**一个连续座区**，而不是分散几个孤立座位；
 *   ③ 区域内已占的**普通座和特殊座一起释放**；
 *   ④ 清理前 3 秒预告（沿用已有的 `EV_CLEAN_WARN` 与橙色圈）。
 *
 * 做法：**滑动窗口**。把地图上每个 `W × H` 的窗口都算一遍「里面有多少已占座位」，
 * 挑最挤的那一片 —— 最挤 = 大家抢得最凶 = 清出来最值得再抢。窗口跨走道没关系
 * （走道格本来就没有座位，不参与计数），所以三个场景不用各自的走道参数去硬编桌组。
 *   · 尺寸 5×5：教室里正好盖住一个桌组（5 列 × 4 行 + 中间一条行走道）；
 *     实测 30 秒时最优窗口 8 格、60 秒时 17 格，与老逻辑「清 20%」的 11 / 19 格同量级。
 *   · 避免连着清同一片：与上一轮窗口重叠超过一半的候选降级，但要求替补的
 *     占座数不低于首选的 60%（有 1C 需求时还要求插座位数不减少）。
 *   · 1C 的保底补救照旧生效：窗口里自带未抢插座位最好；不够 MIN 个时，
 *     从窗口外按「离窗口中心最近」补 —— 仍然一次随机数都不多掷。
 *
 * ⚠️ 关掉时 `evBuildCleanCells()` 整段走回老路径（全图洗牌取 20%），
 *    随机消耗与 v36 逐字相同 → `--events` / `--v2` 老基线继续命中（铁律 1 / 3）。 */
var EV_CLEAN_CLUSTER_ON = true;
var EV_CLEAN_CLUSTER_W = 5;          /* 清理窗口宽（格） */
var EV_CLEAN_CLUSTER_H = 5;          /* 清理窗口高（格） */
var evCleanLastBox = null;           /* 上一轮清过的窗口 { c0, r0 } —— 只用来避免连着清同一片 */

/* 1B 的实现：**读写两侧都保持裸挂钟**，只在「恢复」的那一刻把暂停耗掉的时长
 * **补给每个演员的 `lastClaimAt`** —— 于是「上次占座到现在」的差值天然不含暂停时间。
 *
 *   为什么不是「读的时候减掉一个全局偏移」或「另立一个局内时钟」：
 *   `actor.lastClaimAt` 一直是**挂钟**时间戳，测试台到处在写
 *   `lastClaimAt = performance.now()`（功能回归【39】的 negSeatProbe、V16验收 等）。
 *   只要**读**的那一侧换了量纲，这些「种时间戳」的写法就会与它脱钩 → 假红。
 *   （本轮真栽过两次：先用局内时钟 → 功能回归【39】6 条假红；
 *     再用「挂钟 − 全局偏移」→ 暂停过一次之后，不暂停的连击也再不清零。）
 *   把补偿放在**写侧**（恢复时平移 lastClaimAt），两侧量纲就永远是同一个挂钟。
 *   ⚠️ 平移是纯算术，一个随机数都不消耗；不暂停时这段整段不进 → 与 v36 逐字相同。 */
var pauseStartAt = -1;     /* 当前这次暂停的挂钟起点；未暂停时 -1 */

/* 一键恢复 V1.5 取值。只给回归测试用 —— 玩家永远拿不到这套配置。
   与上面的 var 声明是**成对**的：改一边必须改另一边。 */
function v16SetV15() {
  EV_SCHED_ON = true; EV_ONLY_CLEAN = false; EV_CLEAN_SKIP_FEET = false;
  TASK_COUNT = 3; TASK_REFILL_ON = true; TASK_EXTRA_ON = true; TASK_MILKFISH_ON = true;
  SKILL_SLOT_COUNT = 2;
  FINAL_RUSH_ON = false;        /* 最后 15 秒高潮是第三阶段的新功能，V1.5 基线里不该有 */
  BANNER_STRICT_ON = false;     /* 横幅白名单也是第三阶段的收敛，V1.5 里所有横幅一样大 */
  KEY_DAS_ON = false;           /* 「首次长按延迟」是第九阶段的手感修复，V1.5 里按下即连走 */
  LIB_FIX_ON = false;           /* 图书馆那三处也是 V1.5 就存在的 bug，老基线要能照旧复现 */
  EV_CLEAN_SPECIAL_ON = false;  /* A：V1.5 只清普通座位 —— 特殊座位一占永逸，老基线照旧 */
  PLUG_TICK_ON = true;          /* B：V1.5 插座每 6 秒自动产分，老基线照旧 */
  TASK_PLUG_CUMUL_ON = false;   /* C：V1.5 插座任务读「当前持有数」，老基线照旧 */
  SOLO_PENALTY_ON = false;      /* D：V1.5 单人一撞就出局，老基线照旧 */
  NEG_SEAT_PURE_ON = false;     /* E：V1.5 负分座照样叠连击与区域加成，老基线照旧 */
  COMBO_CLOCK_FIX_ON = false;   /* 1B：V1.5 连击读挂钟（暂停清零），老基线照旧 */
  TASK_PLUG_REMEDY_ON = false;  /* 1C：V1.5 清理不照顾任务目标插座，老基线照旧 */
  EV_CLEAN_CLUSTER_ON = false;  /* 阶段2：V1.5 清理是全图随机散布，老基线照旧 */
  CENTER_CONTEST_ON = false;    /* 阶段5：V1.5 地图没有「中央区」座位，老基线照旧 */
  SCHOLAR_PEEK_ON = false;      /* 阶段7：V1.5 没有「学霸提前预判」，老基线照旧 */
  ROOMIE_FACING_ON = false;     /* 阶段7：V1.5 的室友只按「离自己最近」挑，老基线照旧 */
  ROOMIE_OPEN_ON = false;       /* 阶段8：V1.5 没有「往空地铺」这一档 */
  ROOMIE_LONGER_ON = false;     /* 阶段8追加：V1.5 的室友只替占 3 格就消失 */
  ROOMIE_TIMER_ON = false;      /* 阶段8追加：V1.5 没有「剩 N 秒」药丸 */
  SCHOLAR_SEAT_MARK_ON = false; /* 阶段8追加：V1.5 的学霸地图只有一圈细琥珀线 */
  ROOMIE_MARK_ON = false;       /* 阶段8追加R3：V1.5 的室友替占不留任何记号 */
}
/* 一键恢复 V1.6 取值（= 源码里的默认值）。 */
function v16SetDefault() {
  EV_SCHED_ON = false; EV_ONLY_CLEAN = true; EV_CLEAN_SKIP_FEET = true;
  TASK_COUNT = 1; TASK_REFILL_ON = false; TASK_EXTRA_ON = false; TASK_MILKFISH_ON = false;
  SKILL_SLOT_COUNT = 1;
  FINAL_RUSH_ON = true;
  BANNER_STRICT_ON = true;
  KEY_DAS_ON = true;
  LIB_FIX_ON = true;
  EV_CLEAN_SPECIAL_ON = true;
  PLUG_TICK_ON = false;
  TASK_PLUG_CUMUL_ON = true;
  SOLO_PENALTY_ON = true;
  NEG_SEAT_PURE_ON = true;
  COMBO_CLOCK_FIX_ON = true;
  TASK_PLUG_REMEDY_ON = true;
  EV_CLEAN_CLUSTER_ON = true;
  CENTER_CONTEST_ON = true;
  SCHOLAR_PEEK_ON = true;
  ROOMIE_FACING_ON = true;
  ROOMIE_OPEN_ON = true;
  ROOMIE_LONGER_ON = true;
  ROOMIE_TIMER_ON = true;
  SCHOLAR_SEAT_MARK_ON = true;
  ROOMIE_MARK_ON = true;
}

/* ==========================================================
 * 6c. V1.6 第三阶段：双人最后 15 秒高潮（手册 十一、第十阶段）
 * ----------------------------------------------------------
 * 手册要求：90 秒比赛最后 15 秒进入高潮，**但不改变基础规则** ——
 *   • 显示「最后 15 秒！」   • 适度增强 BGM / 节奏
 *   • 时间数字更加突出       • 高价值座位视觉略加强
 *   • 不要强制加速
 * 所以这里**只做「看得见 / 听得到」的四件事**：横幅、时间数字样式、
 * 高价值座位光晕、每秒滴答。一条规则都不动（不加移动速度、不改 NPC 步频）。
 *
 * ⚠️ 全部调用都不消耗随机数（addBanner / Sound.* / CSS class / 纯绘制）→
 *    指纹回归的 core / grid 零影响（横幅进的是 fx 通道，见 指纹回归.js 的 fxSig）。
 * ========================================================== */
var FINAL_RUSH_ON = true;          /* 总开关（v16SetV15() 会关掉） */
var FINAL_RUSH_SEC = 15;           /* 剩余多少秒进入高潮（手册写的就是 15） */
var FINAL_RUSH_VERSUS_ONLY = true; /* 手册把这一章写在「双人」标题下。改 false 单人也有 */
var FINAL_RUSH_TICK_SEC = 10;      /* 最后多少秒开始每秒一下滴答（「节奏增强」） */
var finalRush = false;             /* 本局是否已经进入高潮 */
var finalRushTickAt = -1;          /* 滴答去重游标：按「剩余整秒」去重，一秒只响一次 */

/* ==========================================================
 * 6d. V1.6 第三阶段：横幅白名单（手册 九、第八阶段「重新梳理 HUD」）
 * ----------------------------------------------------------
 * 手册原文：「大型中央提示**只用于**：管理员清理、任务完成、最后 10 秒、游戏结束。」
 * 而 drawBanners 把**所有**横幅都画成同一个「顶部中央大白框」（只有颜色按 kind 变），
 * 所以「弹一条横幅」就等于「占用一次大型中央提示」。
 *
 * 实测（`测试台/横幅普查.js`，5 局）：改之前共弹 94 条横幅，**83 条（88.3%）在白名单外** ——
 * 黄金后排 / 黄金座位 / 插座位 / 靠门位 每占下一格就弹，学霸地图 / 冲刺 每按一次技能就弹，
 * 里程碑也弹。中央大提示被用到这个程度，等于它不再传递任何「值得抬头看」的信号，
 * 正好违背手册总原则「玩家的眼睛应该主要看游戏角色附近，而不是看 UI」。
 *
 * ⚠️ 做法是**换通道，不是删内容**：白名单外的横幅照样 push 进 banners 数组、
 *    照样画在原来的位置，只是换成「小号无框提示」（见 bannerBox / drawBanners）。
 *    这样做的两个好处：
 *      ① 内容（技能名 / 里程碑文案 / 座位名）一个字都没丢；
 *      ② `banners.length` 不变 → 指纹的 **fx 通道也不变**，四档指纹逐字节一致。
 *    也就是说这是一次**对指纹完全不可见的纯渲染改动** —— 按 §5i/§9.20 的教训，
 *    这种改动必须单独写断言（功能回归【33】），指纹永远证明不了它。
 *
 * ⚠️ 副作用一律照旧：每个调用点旁边的 shake / Sound / addParticles 一个都没动；
 *    addBanner 本来就不消耗随机数，所以对整局随机序列零影响。
 * ========================================================== */
var BANNER_STRICT_ON = true;       /* 总开关（v16SetV15() 会关掉 → 所有横幅恢复一样大） */

/* ----------------------------------------------------------
 * 大型中央提示白名单（手册 §九）：
 *   ① 管理员清理占座   ② 任务完成   ③ 最后 15 秒   ④ 开场倒计时结束
 *
 * ⚠️⚠️ 判定**只认调用点显式传进来的 big 标记，绝不看文案**。
 *
 *    为什么不能按关键词判 —— `st()` 会按场景改写同一句话（见 SCENE_TEXT）：
 *      · 图书馆把「老师开始点名！/老师巡视中！/被老师看见了/被老师盯了一路/
 *        老师提前进教室了！/老师看了一眼…」**全改成带「管理员」的版本**，
 *        技能名「老师来了」→「管理员来了」、座位名「老师眼皮底下」→「管理员眼皮底下」；
 *      · 食堂反过来把「管理员来了！」改成「收桌的来了！」。
 *    所以「文案里带管理员」这条规则在图书馆会把 **9 条普通反馈误升级成大型弹窗**，
 *    在食堂又会把**真正的清理提示误降级** —— 换一个场景就两头翻车。
 *
 *    改成「默认小号、要醒目就在调用点写第 6 个参数 true」之后：
 *      · 判据与文案解耦 → 场景文案怎么改都不会翻转分类；
 *      · 新加的横幅**天然是小号**，不可能悄悄抢走中央区域。
 *    全量核对见 测试台/横幅全量清单.js（静态列全部 45 个调用点 + 逐点判定）。
 * ---------------------------------------------------------- */
var BANNER_BIG_SITE_COUNT = 17;    /* 声明值：调用点里带 big=true 的个数，由上面那个脚本核对 */
function bannerIsBig(text, sub, big) {
  if (!BANNER_STRICT_ON) return true;   /* V1.5 档：所有横幅一样大 */
  return big === true;
}

/* 每帧调一次（在 update() 里 timeLeft 算完之后）。
   ⚠️ 不消耗随机数、不写任何玩法状态 —— 只推横幅 / 播声音 / 置一个纯表现层标志。 */
function updateFinalRush() {
  if (!FINAL_RUSH_ON) return;
  if (state !== 'play') return;
  if (FINAL_RUSH_VERSUS_ONLY && !isVersus()) return;

  if (!finalRush) {
    if (timeLeft > FINAL_RUSH_SEC) return;
    finalRush = true;
    addBanner('⏳', '最后 ' + FINAL_RUSH_SEC + ' 秒！', '抢到的都算数，冲最后一波', 'milestone', 2.2, true);
    Sound.bell();
    return;
  }
  /* 节奏增强：最后 10 秒每秒一下短滴答。按「剩余整秒」去重，一秒钟只响一次。 */
  var sec = Math.max(0, Math.ceil(timeLeft));
  if (sec <= FINAL_RUSH_TICK_SEC && sec !== finalRushTickAt) {
    finalRushTickAt = sec;
    Sound.tick(false);
  }
}

var keyMap = {
  'arrowup': 'up', 'arrowdown': 'down', 'arrowleft': 'left', 'arrowright': 'right',
  'w': 'up', 's': 'down', 'a': 'left', 'd': 'right'
};
var DIRBYNAME = { up: DIRS[0], right: DIRS[1], down: DIRS[2], left: DIRS[3] };

/* ---------- Actor：玩家与 NPC 的统一抽象 ----------
 * 两者本质是同一件事：在网格上走动，把走过的座位变成自己的。
 * 统一之后，V2 加第二个玩家只是往 actors 里多 push 一个人，不用再写一套逻辑。
 *
 * 注意：人类玩家的 id 仍然叫 'player'（不是 'p1'）——
 * 这样 OWN['player'] 配色和 grid[i].owner === 'player' 的判断都不用动，V1 视觉零变化。 */
function makeActor(id, kind, o) {
  o = o || {};
  return {
    id: id,
    kind: kind,                       /* 'human' | 'ai' */
    name: o.name || '',
    emoji: o.emoji || '',

    /* 位置与移动 */
    c: o.c, r: o.r,
    dir: o.dir || DIRS[0],
    stepTimer: 0,
    alive: true,
    blocked: false,                   /* AI 走不动就地坐下 */
    bob: 0,

    /* 计分：每个占座者一套 */
    score: 0, seatCount: 0, specialCount: 0, winCount: 0,
    combo: 0, maxCombo: 0, lastClaimAt: -1e9, milestoneIdx: 0,

    /* 视觉 */
    face: 0, claimFlash: 0,

    /* 输入源（仅 human） */
    input: o.input || null,

    /* AI 人设（仅 ai） */
    bias: o.bias || null,
    lines: o.lines || null,

    /* 头顶气泡 */
    remote: false,                        /* 联机时由网络驱动的远端玩家 */
    bubble: 0, bubbleText: '', bubbleTimer: o.bubbleTimer || 0,
    claimCount: 0,
    blockCount: 0,                    /* 用占座路线堵住别人移动的次数 */
    /* 本局高光用（第九阶段 P1-2）：连续抢到特殊座位的「当前 / 最长」次数。
       纯自增字段 —— 不掷骰子、不参与任何判定，只在结算时被读一次，
       所以有没有它，一局的走向完全一样（指纹回归可证）。 */
    spStreak: 0, spBest: 0,

    /* 角色与技能 */
    role: null,
    skills: [],
    skillCd: [0, 0],
    cdCut: 1,                         /* 技能冷却倍率（第三阶段《充电自由》降到 0.7） */
    titles: [],                       /* 本局拿到的称号 / 评价（结算时展示） */
    dash: 0,                          /* 冲刺剩余时间 */
    slow: 0,                          /* 被点名剩余时间 */
    freeze: 0,                        /* 被奶茶诱惑剩余时间（仅 NPC） */
    cram: false,                      /* 临时抱佛脚：下一次特殊座位翻倍 */
    ghost: 0,                         /* 摸鱼大师「老师来了」剩余时间（可穿行**他人**的占座） */
    mapShow: 0,                       /* 学霸「学霸地图」剩余时间（高价值座位高亮） */
    coupleDone: false,                /* V2：这一局的情侣座奖励是否已经发过（一对只发一次） */
    pace: o.pace || 1,                /* V2：步进间隔倍率（卷王 < 1，走得更快）。仅 NPC 用 */
    rage: 0,                          /* V2 第六节：期末周狂暴的加速剩余秒数（>0 时走得更快） */

    /* ---- V1.6 惩罚性碰撞与复位（第四阶段「复活反馈」） ---- */
    penalty: 0,                       /* 复位等待剩余秒数：>0 时不接受输入、不参与任何判定 */
    invuln: 0,                        /* 复位落地后的短暂保护，防止「复活点又被占」连续受罚 */
    penaltyCount: 0,                  /* 本局被处罚次数（结算里的「碰撞次数」） */
    /* 本局累计占下过几格，只增不减（第三阶段加，给验收矩阵与「还在不在抢」用）。
       与 seatCount 的区别：seatCount 会被管理员清理扣回去，claimCount 不会。 */
    claimCount: 0
  };
}

/* ---------- 输入源：一个玩家一路，互不干扰 ----------
 * 键盘（含按住连走）与摇杆/滑动合成同一个方向出口。
 * 摇杆和拖动分成两个槽位，保持 V1「摇杆优先于拖动」的判定顺序。 */
function makeInput(map) {
  var keys = {}, order = [], tap = null, hold = { joy: null, drag: null };
  /* 「首次长按延迟」用的状态：这次按下的方向，已经走过第一格了吗。
     down() 只在「这个方向本来没按住」时才把它清成 false ——
     系统的按键自动重复会反复触发 keydown，但那时 keys[name] 已经是 true，
     所以自动重复**不会**把 stepped 重置，也就不会再多走一格。 */
  var stepped = {};
  return {
    map: map,
    down: function (name) {
      tap = name;
      if (!keys[name]) { keys[name] = true; order.push(name); stepped[name] = false; }
    },
    up: function (name) {
      keys[name] = false;
      var i = order.indexOf(name);
      if (i >= 0) order.splice(i, 1);
    },
    setTap: function (name) { tap = name; },
    peekTap: function () { return tap; },
    takeTap: function () { var t = tap; tap = null; return t; },
    setHold: function (slot, name) { hold[slot] = name; },
    /* 「这一格是不是『键盘按住』的第一格？」—— 只有它需要首次延迟。
       摇杆 / 手指滑动 / 轻点缓冲都是一次性输入，本身不存在「轻点 vs 长按」的歧义，
       一律返回 false（照常按 actorStepMs 连走），否则摇杆会被拖成 280ms 一步。 */
    takeKeyFirstStep: function (name) {
      if (!keys[name]) return false;      /* 不是「按住键盘」这条通道 */
      if (stepped[name]) return false;    /* 这次按住的第二格起 */
      stepped[name] = true;
      return true;
    },
    /* 键盘优先 → 摇杆 → 拖动，与 V1 的 currentDir() 完全一致 */
    dir: function () {
      for (var i = order.length - 1; i >= 0; i--) {
        if (keys[order[i]]) return DIRBYNAME[order[i]];
      }
      var td = hold.joy || hold.drag;
      return td ? DIRBYNAME[td] : null;
    },
    clear: function () {
      keys = {}; order = []; tap = null; hold.joy = null; hold.drag = null; stepped = {};
    }
  };
}

/* ---------- 角色与技能 ----------
 * 每个角色 2 个技能（不做自由搭配，符合「轻量角色」的定位）。
 * **槽位 0 是招牌技能** —— 第四阶段要求「角色改变玩法」，四个招牌技能各改一条规则：
 *   学霸     🗺️ 学霸地图   → 把全场还没被占的高价值座位点亮，规划路线变成可能
 *   摸鱼大师 👻 老师来了   → 自己的占座路线暂时可以穿过去，被围死也能钻出来
 *   行动派   💨 冲刺       → 短时间高速移动，专门抢特殊座
 *   社交达人 🙋 求助室友   → 召一个室友替你把路线旁边的连座占下来
 * 默认不给角色（role = null）时，所有加成为 0、技能为空 —— 核心循环与 V1 完全一致。 */
var SKILLS = {
  /* ---- 招牌技能（第四阶段） ---- */
  map:     { name: '学霸地图',   emoji: '🗺️', cd: 18, dur: 8,  toast: '全场高价值座位亮起来了' },
  /* V1.6 第一阶段：自己的占座变成所有人的默认通路之后，
   * 「老师来了」不再需要拿来做「穿自己的路线」——
   * 它的新语义是**穿过别人的占座区域**（经过时不抢夺、不计分）。toast 跟着改，
   * 否则玩家会按旧理解用这个技能（以为它只对自己的格子生效）。 */
  ghost:   { name: '老师来了',   emoji: '👻', cd: 20, dur: 6,  toast: '短时间内能穿过别人的占座' },
  help:    { name: '求助室友',   emoji: '🙋', cd: 22, dur: 12, toast: '室友来帮你占连座' },
  /* ---- 通用技能（V1.5 已有） ---- */
  dash:    { name: '冲刺',       emoji: '💨', cd: 16, dur: 3.5, toast: '短时间跑得飞快' },
  milk:    { name: '奶茶诱惑',   emoji: '🧋', cd: 16, dur: 3.5, toast: '附近的同学都去喝奶茶了' },
  callout: { name: '点名危机',   emoji: '📢', cd: 20, dur: 4,   toast: '对手被点名，速度骤降' },
  bike:    { name: '共享单车',   emoji: '🚲', cd: 15, dur: 0,   toast: '一路骑过去' },
  cram:    { name: '临时抱佛脚', emoji: '📖', cd: 14, dur: 0,   toast: '下一次特殊座位翻倍' }
};

/* 四个角色。tag 是定位，desc 是给玩家看的一句话 —— 全部指向「怎么玩」，
 * 不再是「前排 +30%」那种纯数值描述。
 * 第四阶段把 frontBonus / backBonus 这套纯数值加成**删掉了**：
 * 手册批评的正是「角色差异只有数值变化」，现在四个角色的区别在玩法本身。
 *
 * V1.6 第二阶段：每个角色只启用 **skills[0] 那个招牌技能**（见 SKILL_SLOT_COUNT）。
 * 数组里仍然写着两个 —— 这样 setV16(false) 能一键回到 V1.5 的双技能配置，
 * 老指纹基线才有意义。玩家看到、能用到的永远只有第一个。 */
var ROLES = [
  { id: 'scholar', name: '学霸',     emoji: '🎓', tag: '规划型',
    desc: '特殊座位 +50% 分', skills: ['map', 'cram'] },
  { id: 'slacker', name: '摸鱼大师', emoji: '😎', tag: '免疫型',
    desc: '免疫负面：负分座 / 老师盯梢不掉分', skills: ['ghost', 'milk'] },
  { id: 'doer',    name: '行动派',   emoji: '🏃', tag: '速度型',
    desc: '连击奖励翻倍', skills: ['dash', 'callout'], speed: 0.88 },
  { id: 'social',  name: '社交达人', emoji: '🤝', tag: '辅助型',
    desc: '室友每帮你占一座 +15 分', skills: ['help', 'milk'], social: true }
];

/* 角色实际拿到的技能表。SKILL_SLOT_COUNT = 1 时就是「只剩招牌技能」。
 * 被动差异（speed / social / desc 里那几条）不走这里，原样保留。 */
function roleSkills(r) {
  return r ? r.skills.slice(0, SKILL_SLOT_COUNT) : [];
}

/* 本局各玩家选的角色（默认给一套，避免新手进来没技能用） */
var rolePick = ['scholar', 'slacker'];

function roleById(id) {
  for (var i = 0; i < ROLES.length; i++) if (ROLES[i].id === id) return ROLES[i];
  return null;
}

/* 给 Actor 装配角色（roleId 为 null 时清空，行为回到 V1） */
function applyRole(actor, roleId) {
  var r = roleId ? roleById(roleId) : null;
  actor.role = r;
  /* V1.6 第二阶段：只装配招牌技能（roleSkills 按 SKILL_SLOT_COUNT 截断） */
  actor.skills = roleSkills(r);
  actor.skillCd = [0, 0];
  actor.dash = 0; actor.slow = 0; actor.freeze = 0; actor.cram = false;
  /* 第四阶段的招牌技能状态。清角色时一并归零 —— 保证「无角色 = V1 行为」 */
  actor.ghost = 0;      /* 摸鱼大师「老师来了」：可穿过**他人**占座的剩余秒数（V1.6 起语义） */
  actor.mapShow = 0;    /* 学霸「学霸地图」：高价值座位高亮的剩余秒数 */
  /* 高光计数一并归零：换角色 / 清角色后不该继承上一局的连抢记录 */
  actor.spStreak = 0; actor.spBest = 0;
  /* V1.6：惩罚 / 复位状态也一并归零 —— 换角色不该把上一局的复位等待带进来 */
  actor.penalty = 0; actor.invuln = 0; actor.penaltyCount = 0;
  /* V1.6 第三阶段：累计占座次数（本局一共占下过几格，只增不减）。
     纯计数 —— 不掷骰子、不参与任何判定，只在验收矩阵与结算里被读。
     它和 seatCount 的区别很重要：seatCount 会被管理员清理扣回去，
     所以「后半段还在不在抢」这件事必须看这个只增不减的计数才问得准。 */
  actor.claimCount = 0;
  return r;
}

/* 这个 Actor 每走一格要多少毫秒（角色被动 + 冲刺 / 点名危机 + 场景安静区） */
function actorStepMs(a) {
  var ms = PLAYER_STEP_MS;
  if (a.role && a.role.speed) ms *= a.role.speed;
  /* 冲刺：约 +39% 速度。太快会让玩家一冲就撞进死胡同。
     场景的安静区可以整段禁掉这个加速（手册第五阶段：图书馆「安静区域限制高速移动」）。
     教室的 quiet 是 null，sceneQuietBlocksDash 恒为 false —— 与重构前逐字一致。 */
  if (a.dash > 0 && !sceneQuietBlocksDash(a)) ms *= 0.72;
  if (a.slow > 0) ms *= 1.6;
  /* 图书馆安静区：**高分但走得慢**。手册第六阶段要的正是这个取舍 ——
     安静区里的座位值 1.4 倍，代价是每格都磨蹭。教室 / 食堂 lib 为 null → 不加不减。
     ⚠️ 2026-10-03 修：这里是**除以速度倍率**（0.72 = 只剩 72% 速度 → 间隔 130→181ms）。
     改前写的是 `ms *= 0.72`（间隔 93.6ms）—— 安静区比外面快 39%，与设定正好相反。
     `LIB_FIX_ON` 关掉时逐字回到旧算式，老基线可比。 */
  if (libOn() && inLibQuiet(a.c, a.r)) {
    ms = LIB_FIX_ON ? ms / SCENE.lib.quietSpeedMult : ms * SCENE.lib.quietSpeedMult;
  }
  /* 食堂「开饭铃响」：所有学生速度提升 —— 玩家也在「学生」里，所以这里同样加速。
     只乘间隔，不增减任何随机调用。教室 / 图书馆 dineBell 恒为 0 → 不加不减。 */
  if (dineOn() && dineBell > 0) ms *= SCENE.dine.bellStepMult;
  return ms;
}

/* 社交达人：同学不会去抢他附近的座位 */
function socialReserved(c, r) {
  for (var i = 0; i < humans.length; i++) {
    var h = humans[i];
    if (!h.role || !h.role.social) continue;
    if (Math.abs(c - h.c) + Math.abs(r - h.r) <= 2) return true;
  }
  return false;
}

/* ---------- 对战模式 ----------
 * solo   ：V1 单人抢座（1 名玩家 + 3 个 NPC），行为与 V1 完全一致
 * versus ：双人同屏对战（2 名玩家 + 3 个 NPC） */
var MODE = 'solo';
function isVersus() { return MODE === 'versus'; }

/* ---------- 联机（WebRTC P2P） ----------
 * 房主权威：房主跑完整模拟，访客只收快照渲染并回传自己的输入。
 * 这样最省事也最不容易不同步 —— 全网只有一份权威状态。 */
var NET = { role: null, room: '', selfId: null, conn: false, status: '', vsOnline: false };
var netTick = 0;
function isNet() { return !!NET.role; }
function isHost() { return NET.role === 'host'; }
function isGuest() { return NET.role === 'guest'; }
/* 自己的 Actor id：房主是 player(1P)，访客是 p2(2P) */
function netSelfId() { return NET.selfId; }

var OWNER_CODE = { player: 'p', p2: 'q', n1: '1', n2: '2', n3: '3' };
var CODE_OWNER = { p: 'player', q: 'p2', '1': 'n1', '2': 'n2', '3': 'n3' };

function netStatus(msg) {
  NET.status = msg;
  var el = document.getElementById('net-status');
  if (el) el.textContent = msg;
}

function encodeGrid() {
  var out = new Array(grid.length);
  for (var i = 0; i < grid.length; i++) {
    var o = grid[i].owner;
    out[i] = o ? (OWNER_CODE[o] || '-') : '-';
  }
  return out.join('');
}

/* 房主 → 访客：状态快照 */
function netSendSnapshot() {
  if (!isHost() || !Net.connected()) return;
  var a = [];
  for (var i = 0; i < humans.length; i++) {
    var h = humans[i];
    a.push({
      c: h.c, r: h.r, d: h.dir ? h.dir.n : 'up', bob: Math.round(h.bob * 100) / 100,
      sc: h.score, st: h.seatCount, sp: h.specialCount, wn: h.winCount,
      cb: h.combo, mc: h.maxCombo, bk: h.blockCount, al: h.alive ? 1 : 0,
      cd0: Math.ceil(h.skillCd[0] || 0), cd1: Math.ceil(h.skillCd[1] || 0),
      /* V1.6 第一阶段 ⑦：惩罚性碰撞的三件套也要同步 ——
       *   pn 复位等待剩余秒数（访客拿去显示倒计时，不自己推进、不自己复位）
       *   iv 复位后的保护期（访客据此画无敌闪烁）
       *   pc 本局被罚次数（结算里的「碰撞次数」）
       * 位置 c/r 本来就在快照里，所以「复位到安全走道」这件事
       * 访客不需要知道，房主算完下一帧快照自然就带过去了。 */
      pn: Math.round((h.penalty || 0) * 100) / 100,
      iv: (h.invuln > 0) ? 1 : 0,
      pc: h.penaltyCount || 0
    });
  }
  var np = [];
  for (i = 0; i < npcs.length; i++) {
    var n = npcs[i];
    np.push({ c: n.c, r: n.r, d: n.dir ? n.dir.n : 'up', b: n.blocked ? 1 : 0 });
  }
  Net.send({
    t: 's', st: state, ct: Math.round(countT * 10) / 10, tl: Math.round(timeLeft * 10) / 10,
    a: a, n: np, g: encodeGrid()
  });
}

/* 访客 → 房主：自己的输入 */
function netSendInput() {
  if (!isGuest() || !Net.connected()) return;
  var inp = humanInputs[1];
  var d = inp.dir();
  Net.send({ t: 'i', h: d ? d.n : null, p: inp.peekTap() });
  if (inp.peekTap()) inp.takeTap();
}

/* 房主：把访客的输入落到 2P 身上 */
function netApplyGuestInput(msg) {
  if (!isHost() || humans.length < 2) return;
  var g = humans[1];
  g.netHold = msg.h || null;
  if (msg.p) g.netTap = msg.p;
}

/* 访客：用快照刷新本地状态，然后照常渲染 */
function netApplySnapshot(m) {
  /* 访客不发模拟，只镜像房主的状态 */
  state = m.st;
  countT = m.ct;
  timeLeft = m.tl;
  if (m.a[0] && player) {
    var a0 = m.a[0];
    player.c = a0.c; player.r = a0.r; player.dir = DIRBYNAME[a0.d] || DIRS[0];
    player.bob = a0.bob || 0;
    player.score = a0.sc; player.seatCount = a0.st; player.specialCount = a0.sp;
    player.winCount = a0.wn; player.combo = a0.cb; player.maxCombo = a0.mc;
    player.blockCount = a0.bk; player.alive = !!a0.al;
    /* V1.6 第一阶段 ⑦：复位状态照抄房主，访客端一个字都不自己算。
     * penalty 只在「显示」层被读，访客的 update() 在第一步就 return 了，
     * 走不到 actor 循环里的那个复位判定 —— 所以访客永远不会自己复位。 */
    player.penalty = a0.pn || 0; player.invuln = a0.iv ? 1 : 0;
    player.penaltyCount = a0.pc || 0;
    if (player.skillCd) { player.skillCd[0] = a0.cd0 || 0; player.skillCd[1] = a0.cd1 || 0; }
  }
  if (m.a[1] && humans.length > 1) {
    var a1 = m.a[1], g = humans[1];
    g.c = a1.c; g.r = a1.r; g.dir = DIRBYNAME[a1.d] || DIRS[0];
    g.bob = a1.bob || 0;
    g.score = a1.sc; g.seatCount = a1.st; g.specialCount = a1.sp;
    g.winCount = a1.wn; g.combo = a1.cb; g.maxCombo = a1.mc;
    g.blockCount = a1.bk; g.alive = !!a1.al;
    /* V1.6 第一阶段 ⑦：同上 —— 1P 的复位状态也照抄房主 */
    g.penalty = a1.pn || 0; g.invuln = a1.iv ? 1 : 0;
    g.penaltyCount = a1.pc || 0;
    if (g.skillCd) { g.skillCd[0] = a1.cd0 || 0; g.skillCd[1] = a1.cd1 || 0; }
  }
  if (m.n) {
    /* 阶段 4：房主可能开了「纯真人实验模式」（这一局没有 NPC）。
       访客这边若还留着 3 个 NPC，它们会永远停在出生点被画出来 —— 跟着清掉。
       ⚠️ 正常情况两边都是 3 个，长度相等 → 下面这段一次都不执行。 */
    while (npcs.length > m.n.length) {
      var dead = npcs.pop();
      var di = actors.indexOf(dead);
      if (di >= 0) actors.splice(di, 1);
    }
    for (var i = 0; i < npcs.length && i < m.n.length; i++) {
      var n = npcs[i], sn = m.n[i];
      n.c = sn.c; n.r = sn.r; n.dir = DIRBYNAME[sn.d] || DIRS[0]; n.blocked = !!sn.b;
    }
  }
  if (m.g) {
    for (i = 0; i < grid.length && i < m.g.length; i++) {
      var ch = m.g.charAt(i);
      grid[i].owner = (ch && ch !== '-') ? (CODE_OWNER[ch] || null) : null;
    }
  }
}

/* 双人时两套按键不能抢键：1P 用 WASD，2P 用方向键。
 * 单人时 WASD 和方向键都归玩家（与 V1 一致）。
 *
 * V1.6 第二阶段：每个角色只剩槽位 0 的招牌技能，所以每人只需要一个技能键。
 * 原来的第二槽 E / . 整条摘掉 —— 键位表里没有它们，
 * onKeyDown 就不会再走技能分支，按下 E 只会在键表里查不到、静默忽略。
 *
 * ⚠️ R3.3（2026-10-22 用户：「双人开战各自放技能分别设置一个按键，不能只有一个 Q 键」）：
 * 2P 的技能键从「,」换成「L」。
 * 为什么换：`,` 在中文输入法下经常打不出来（全角/半角两套），
 * 而且它在键盘右下角、离方向键很近，2P 按方向键时手掌容易误触。
 * L 在右手食指/中指的常规活动范围，方向键 → 左上移一指就到，中文输入法下也是字母键。
 * **注意：这只是"更好按"，不是"从无到有"** —— 两套键本来就有（Q / ,），
 * 用户感知到「只有一个 Q」，真因是**界面和文案只写了 Q**（HUD 1P 键帽、主提示、
 * 双人模式说明、2P 的四张角色卡 title）。那些都在 R3.3 一起补齐。 */
var SKILL_KEYS = {
  'q': { p: 0, slot: 0 },
  'l': { p: 1, slot: 0 }
};

/* R3.3：技能键的**唯一真值**。UI 键帽、文案、规则页、探针都从这里取，
 * 不许在别处硬编码 'Q' / 'L' —— 否则改键又要满地找字符串（这次就是这么踩到的）。
 * 单人模式 2P 不参战，但键帽仍照实显示，方便玩家知道双人怎么按。 */
var SKILL_KEY_LABELS = ['Q', 'L'];

var KEYMAP_SOLO = keyMap;
var KEYMAP_P1_VS = { 'w': 'up', 's': 'down', 'a': 'left', 'd': 'right' };
var KEYMAP_P2_VS = {
  'arrowup': 'up', 'arrowdown': 'down', 'arrowleft': 'left', 'arrowright': 'right'
};

var HUMAN_SETUP = {
  solo:   [{ id: 'player', name: '我' }],
  versus: [{ id: 'player', name: '1P' }, { id: 'p2', name: '2P' }]
};

/* 输入源与 Actor 分开保存：Actor 每局重建，输入源跨局复用（重开不丢按键状态） */
var humanInputs = [makeInput(KEYMAP_SOLO), makeInput(KEYMAP_P2_VS)];
var humans = [];              /* 本局的人类玩家（1 或 2 个） */

/* ===== V36 下一阶段 · 阶段 4：双人「纯真人模式」（2026-10-18） =====
 * 文档原文：「当前双人还有电脑角色，需要验证两名真人是否真的在互相竞争。
 *            不要永久删除 NPC，只做可切换测试配置。」
 *
 * R3.5（2026-10-22，用户要求）：「双人对决中去掉 NPC 角色，只保留两个玩家」
 *   → **双人局默认就是纯真人**，不再是实验开关。单人模式**照常有 NPC**。
 *
 * 生效范围（`purePvpOn()` 自带 `isVersus()`）：
 *   · 双人对决 → 不建 NPC + 双方从「同一条横走道、隔中心相望」进场；
 *   · 单人模式 → 一个字节都不变，NPC 陪跑照旧。
 *
 * 开关（想回到「双人也有 3 个 NPC」时用，**不删任何代码**）：
 *   · URL 加 `?purepvp=0`（邀请链接会跟着带，见 `inviteExtra()`）
 *   · 测试里调 `setPurePvp(false)`
 *
 * ⚠️ 关掉时 `resetGame` 里 NPC 那段循环逐字不变 → 随机消耗与 v36 一致（铁律 1）；
 *    `humanHome` 也走原来的分支。所以「关」这一侧的指纹一格不动。
 * ⚠️ 打开时**不消耗任何随机数**（整段循环被跳过），所以它不会让别的系统错位。 */
var PURE_PVP_TEST_MODE = true;     /* R3.5：默认开。名字保留，历史报告里还引用它 */
var DUEL_AI_ENABLED = false;       /* = !PURE_PVP_TEST_MODE，永不同步 */

function setPurePvp(on) {
  PURE_PVP_TEST_MODE = !!on;
  DUEL_AI_ENABLED = !PURE_PVP_TEST_MODE;
  return PURE_PVP_TEST_MODE;
}
/* 真正生效的判据：只有双人模式才有意义（单人本来就该有 NPC 陪跑）。
 * ⚠️ 刻意绑在 `DUEL_AI_ENABLED` 上而不是 `PURE_PVP_TEST_MODE`：
 *    这样「只把 DUEL_AI_ENABLED 改成 true」也会**连起点一起退回** ——
 *    否则会出现「有 NPC、但两人挤在中心」的半开状态。 */
function purePvpOn() { return isVersus() && !DUEL_AI_ENABLED; }

function purePvpFromUrl() {
  try {
    var q = (window.location && window.location.search) || '';
    /* R3.5：`?purepvp=0` 显式关掉（回到「双人也有 NPC」的老行为） */
    if (/[?&]purepvp=0(?:&|$)/.test(q)) { setPurePvp(false); return; }
    if (/[?&]purepvp=1(?:&|$)/.test(q)) { setPurePvp(true); return; }
  } catch (e) {}
}

/* 实验模式的双方起点：取「离地图中心最近的那条横走道」，再取它左右各一条竖走道。
 * 两个人同一条横走道、隔着中心相望 —— 谁往中间走都能立刻撞上对方。
 * 场景不同（教室 6/2/5/3、图书馆 5/2/4/2、食堂 7/3/6/3）走道位置不同，
 * 所以这里**按 isAisle 现算**，不写死坐标。找不到合适的走道时返回 null，
 * 调用方退回原来的左右两端（宁可退回，也不把人放进座位堆里）。 */
function purePvpHomes() {
  var cc = Math.floor(COLS / 2), cr = Math.floor(ROWS / 2);
  var r = -1, bestD = 1e9, c, d;
  for (var rr = 0; rr < ROWS; rr++) {
    if (!isAisle(0, rr)) continue;
    d = Math.abs(rr - cr);
    if (d < bestD) { bestD = d; r = rr; }
  }
  var cL = -1, cR = -1, dL = 1e9, dR = 1e9;
  for (c = 0; c < COLS; c++) {
    if (!isAisle(c, 0)) continue;
    if (c < cc && cc - c < dL) { dL = cc - c; cL = c; }
    if (c > cc && c - cc < dR) { dR = c - cc; cR = c; }
  }
  if (r < 0 || cL < 0 || cR < 0) return null;
  return [[cL, r], [cR, r]];
}

function humanHome(mode, index) {
  if (mode === 'versus') {
    /* 阶段 4/5：双人从「同一条横走道、隔着中心相望」进场（教室约 6 格）。
       阶段 4 先只对纯真人实验模式生效；阶段 5 按文档「P1、P2 起点不要距离过远」
       推广到**所有双人**。R3.5 之后双人默认就是纯真人，两条口径在这里合流，
       所以本函数**已与 NPC 开关无关** —— 关掉 `?purepvp=0`（要 NPC）时起点也不退回。
       关掉 CENTER_CONTEST_ON（V1.5 基线）时退回原来的左右两端。 */
    if (CENTER_CONTEST_ON) {
      var pair = purePvpHomes();
      if (pair) return pair[index === 0 ? 0 : 1];
    }
    return index === 0
      ? [Math.round(COLS * 0.26), Math.floor(ROWS / 2) + 1]
      : [Math.round(COLS * 0.74), Math.floor(ROWS / 2) + 1];
  }
  return [Math.floor(COLS / 2), Math.floor(ROWS / 2) + 1];
}

function applyKeymaps() {
  humanInputs[0].map = isVersus() ? KEYMAP_P1_VS : KEYMAP_SOLO;
  humanInputs[1].map = KEYMAP_P2_VS;
  applySkillKeyLabels();
}

/* R3.3：把 SKILL_KEY_LABELS 写进 HUD 的两颗技能键帽。
 * 为什么不在 index.html 里写死 'Q' / 'L'：这次改键踩的就是「同一件事散落在
 * HTML 键帽 + 主提示 + 模式说明 + 规则页 + 8 张角色卡 title」共 6 处的坑，
 * 改了一处漏五处。键帽改由真值表驱动，剩余文案仍写在 HTML（它们是句子，不是键位表）。 */
function applySkillKeyLabels() {
  var i, el;
  for (i = 0; i < SKILL_KEY_LABELS.length; i++) {
    el = document.getElementById('sk-' + (i + 1) + '-0');
    if (!el) continue;
    var kb = el.querySelector ? el.querySelector('.sk-key') : null;
    if (kb) kb.textContent = SKILL_KEY_LABELS[i];
  }
}

function actorById(id) {
  for (var i = 0; i < actors.length; i++) if (actors[i].id === id) return actors[i];
  return null;
}

/* 某个 Actor 这一帧要走的方向（键盘 → 摇杆 → 轻点缓冲） */
function actorInputDir(a) {
  if (!a) return null;
  /* 联机时 2P 是远端玩家，方向来自网络而不是本地输入 */
  if (a.remote) {
    if (a.netHold) return DIRBYNAME[a.netHold] || null;
    if (a.netTap) return DIRBYNAME[a.netTap] || null;
    return null;
  }
  if (!a.input) return null;
  var d = a.input.dir();
  if (d) return d;
  var t = a.input.peekTap();
  return t ? DIRBYNAME[t] : null;
}

/* 同一套优先级，但返回**方向名**（"up"/"down"/…）。
 * 「首次长按延迟」要按「哪个键」分别记账，所以必须拿到名字而不是 DIR 对象。
 * 判定顺序与 actorInputDir 逐字一致，两者不会给出不同的方向。 */
function actorInputName(a) {
  if (!a) return null;
  if (a.remote) return a.netHold || a.netTap || null;
  if (!a.input) return null;
  var d = a.input.dir();
  if (d) return d.n;
  return a.input.peekTap();
}

/* ==========================================================
 * 4. 小工具
 * ========================================================== */

function rr(g, x, y, w, h, r) {
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/* rr 的「不另起一条路径」版：往**当前路径**上追加一个圆角矩形。
 * 用途是「一次 fill 画一堆同样的东西」（排队长龙里十几个小人）。
 * rr 内部有 beginPath，循环里调它会把前一个图形冲掉，所以批量绘制必须用这个。 */
function rrPath(g, x, y, w, h, r) {
  if (r > w / 2) r = w / 2;
  if (r > h / 2) r = h / 2;
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function font(size, weight) {
  return (weight || 700) + ' ' + size + 'px "PingFang SC","HarmonyOS Sans SC","Microsoft YaHei","Segoe UI",system-ui,sans-serif';
}
function emojiFont(size) {
  return size + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
}

function addFloat(x, y, text, color, size, life, isScore, delta, cls) {
  /* 密集占座时把连续的飘分合并成一个不断累加的数字，避免糊成一片 */
  if (isScore) {
    var now = performance.now();
    for (var i = floats.length - 1; i >= 0; i--) {
      var f = floats[i];
      if (f.isScore && now - f.born < 360) {
        f.acc += delta;
        f.text = (f.acc >= 0 ? '+' : '') + f.acc;
        f.color = f.acc >= 0 ? '#D9480F' : '#1B7A3E';
        f.life = Math.max(f.life, 0.8);
        f.max = Math.max(f.max, 1.15);
        f.size = Math.min(30, f.size + 1.1);
        /* 合并进来的如果是特殊座位，就把整条飘字恢复可见 */
        if (cls !== 'mute') f.cls = '';
        /* 平滑地跟着玩家走 */
        f.x += (x - f.x) * 0.4;
        f.y += (y - f.y) * 0.4;
        return;
      }
    }
  }
  floats.push({
    x: x, y: y, text: text, color: color || '#2E2A26',
    size: size || FS('fM'), life: life || 1.1, max: life || 1.1,
    isScore: !!isScore, acc: delta || 0, born: performance.now(),
    cls: cls || ''
  });
  while (floats.length > 9) floats.shift();
}

/* rng 是可选参数：事件系统要传自己的随机流进来（evRand）。
 * 事件如果直接用 Math.random 放烟花，就会挪动随机数的消耗顺序，
 * 连带把整局 NPC 走位全部改掉 —— 那样「加事件」就不再是纯增量的改动。
 * 不传时用 Math.random，与 V1 逐位一致。 */
function addParticles(x, y, n, colors, power, rng) {
  var R = rng || Math.random;
  for (var i = 0; i < n; i++) {
    var a = R() * Math.PI * 2;
    var sp = (0.6 + R() * 1.5) * (power || 1);
    parts.push({
      x: x, y: y,
      vx: Math.cos(a) * sp * 60,
      vy: Math.sin(a) * sp * 60 - 60,
      life: 0.55 + R() * 0.6,
      max: 1.15,
      size: 2.5 + R() * 4,
      color: colors ? colors[Math.floor(R() * colors.length)] : '#FFC93C',
      rot: R() * 6.28,
      vr: (R() - 0.5) * 12,
      star: R() < 0.5
    });
  }
}

/* 横幅：V1.5 把持续时间收短到 1.5 秒（手册指定），最多同屏 2 条，避免糊住上半屏 */
/* big = 第 6 个参数：**只有调用点能决定它大不大**（见 bannerIsBig 的注释）。
   不传就是小号 —— 这是刻意的「默认安全」，别改成按文案猜。 */
function addBanner(emoji, text, sub, kind, life, big) {
  var L = life || 1.5;
  /* V1.6 第三阶段（手册 §九）：没在调用点上标 big 的横幅打上 quiet 标记，由 drawBanners 用小号画。
     ⚠️ 仍然**照常 push 进 banners**（数组长度不变 → 指纹的 fx 通道也不变），
        quiet 只影响画面，不影响任何判定，也不消耗随机数。 */
  banners.push({
    emoji: emoji, text: text, sub: sub || '', kind: kind || 'good', life: L, max: L,
    quiet: !bannerIsBig(text, sub, big)
  });
  if (banners.length > 2) banners.shift();
}

/* 横幅的尺寸 / 几何 —— 抽成函数是为了让**绘制**与**断言**共用同一份。
 * （经验手册 §9.5：断言不许去猜「小号到底多小」，必须问这个函数。）
 * 位置（top / step）两种横幅完全一致 —— 这次只改大小，不动布局。 */
function bannerBox(b) {
  var q = !!b.quiet;
  var sub = b.sub || '';
  return {
    quiet: q,
    /* 主文案字号：大号 h1，小号降到 task 档 */
    font1: q ? FS('task') : FS('h1'),
    /* ⚠️ 量副文案宽度用的字号与真正画它用的字号在原实现里**本来就不一样**
       （量用 hud、画用 task）—— 这里照抄，别顺手「修正」，
       否则大号横幅的盒宽会跟着变，白名单内的观感就被改动了。 */
    font2m: q ? FS('fS') : FS('hud'),
    font2: q ? FS('fS') : FS('task'),
    /* 盒高：小号 24（无副文案）/ 34（有副文案）；大号 46 / 62 */
    h: q ? (sub ? 34 : 24) : (sub ? 62 : 46),
    minW: q ? 150 : 200,
    pad1: q ? 30 : 78,
    pad2: q ? 18 : 60,
    r: q ? 9 : 16,
    lw: q ? 1.5 : 3,
    /* 整体不透明度上限：小号略收，避免抢视线 */
    alpha: q ? 0.86 : 1,
    top: 44,
    step: 76,
    emojiDx: q ? 15 : 26,
    textDx: q ? 10 : 14,
    textDy: q ? (sub ? -7 : 0) : (sub ? -9 : 0),
    subDy: q ? 8 : 15,
    /* 小号不画底板阴影框（手册要的是「不使用大弹窗」，不是「不许有反馈」） */
    plate: !q
  };
}

function shake(mag, dur) {
  shakeMag = Math.max(shakeMag, mag);
  shakeDur = dur;
  shakeT = dur;
}

function pctClaimed() {
  var n = 0, s = 0;
  for (var i = 0; i < grid.length; i++) {
    if (grid[i].aisle) continue;
    s++;
    if (grid[i].owner) n++;
  }
  return s ? n / s : 0;
}

/* ==========================================================
 * 5. 关卡生成
 * ========================================================== */

function buildGrid() {
  grid = new Array(COLS * ROWS);
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      grid[I(c, r)] = {
        type: 'normal',
        aisle: isAisle(c, r),
        owner: null,
        item: '',
        anim: 0,
        contest: false,
        contestT: 0,
        vsMark: 0,          /* 双人同座竞争的短暂高亮（秒） */
        claimAge: 0,
        /* 阶段 8 追加 R3：这一格是不是**室友替我拿的**（2/0；改前是 1/0）。
           只在 claimTile 里按 viaHelper 写，纯数据 —— 指纹 gridSig 不读它。 */
        hm: 0,
        /* 阶段 8 追加 R3.2：这一格是不是「室友**刚经过**就顺手占下的」（1/0）。
           = 0.6 秒经过高亮用；同样是纯数据，指纹不读。 */
        hmh: 0
      };
    }
  }
}

function collect(cands, n, used) {
  var pool = [];
  for (var i = 0; i < cands.length; i++) {
    var k = I(cands[i][0], cands[i][1]);
    if (used[k]) continue;
    if (grid[k].aisle) continue;      /* 走道上不放特殊座位 */
    pool.push(cands[i]);
  }
  shuffle(pool);
  return pool.slice(0, n);
}

function placeSpecials() {
  var used = {};
  function put(c, r, type) {
    if (!inB(c, r) || grid[I(c, r)].aisle) return;
    grid[I(c, r)].type = type;
    used[I(c, r)] = true;
  }

  var i, c, r;
  /* 特殊座位数量随教室大小等比缩放，保持“普通座位为主”的手感。
     倍率从当前场景读（教室 1 / 紧凑 0.7）—— 与重构前逐字一致。 */
  var k = COMPACT ? SCENE.specialK.compact : SCENE.specialK.normal;
  /* nGold 保持 V1 原样（5 个 / 紧凑 4 个）—— 这个数一旦变，靠门位、插座位、
   * 空调位的候选池大小都会跟着变，洗牌消耗的随机数次数就变了，整局 NPC 走位错位。
   * 第三阶段需要的额外黄金后排由文件末尾那段「确定性补足」来加。 */
  var nGold = Math.max(3, Math.round(5 * k));
  var nDoor = Math.max(2, Math.round(4 * k));
  var nPlug = Math.max(3, Math.round(5 * k));
  var nAc = Math.max(2, Math.round(3 * k));

  /* 老师眼皮底下：最前排中央固定区域（取中线附近 5 个座位） */
  var mid = Math.floor(COLS / 2);
  var placed = 0;
  for (var off = 0; off < COLS && placed < 5; off++) {
    var cands = off === 0 ? [mid] : [mid - off, mid + off];
    for (var q = 0; q < cands.length && placed < 5; q++) {
      c = cands[q];
      if (!inB(c, 0) || grid[I(c, 0)].aisle) continue;
      put(c, 0, 'teacher');
      placed++;
    }
  }

  /* 黄金后排：最后一排随机（与 V1 完全一致） */
  var row = [];
  for (c = 1; c <= COLS - 2; c++) row.push([c, ROWS - 1]);
  var golds = collect(row, nGold, used);
  for (i = 0; i < golds.length; i++) put(golds[i][0], golds[i][1], 'gold');
  var haveGold = golds.length;

  /* 靠门位：右墙门附近（门在右侧下部） */
  var doors = [];
  for (r = ROWS - 6; r <= ROWS - 1; r++) {
    for (c = COLS - 4; c <= COLS - 2; c++) doors.push([c, r]);
  }
  var ds = collect(doors, nDoor, used);
  for (i = 0; i < ds.length; i++) put(ds[i][0], ds[i][1], 'door');

  /* 插座位：靠墙两侧。
     图书馆不一样 —— 插座**只长在「插座区」那条靠墙竖带里**，而且全场只有 plugCount 个。
     这就是手册要的「插座区：资源稀缺，多人竞争」。
     ⚠️ 候选池大小决定 shuffle 消耗多少 Math.random（nGold 那个坑的同源问题），
        所以只改图书馆这一支；else 分支与重构前逐字相同，教室/食堂的地图骨架一点没动。 */
  var plugs = [];
  if (SCENE.lib) {
    var pcMax = libPlugColMax();
    for (r = 3; r <= ROWS - 4; r++) {
      for (c = 1; c <= pcMax; c++) plugs.push([c, r]);
    }
  } else {
    for (r = 3; r <= ROWS - 4; r++) {
      plugs.push([1, r]); plugs.push([2, r]);
      plugs.push([COLS - 3, r]); plugs.push([COLS - 2, r]);
    }
  }
  var ps = collect(plugs, SCENE.lib ? SCENE.lib.plugCount : nPlug, used);
  plugCells = [];
  for (i = 0; i < ps.length; i++) {
    put(ps[i][0], ps[i][1], 'plug');
    plugCells.push(ps[i]);
  }

  /* 空调位：左墙窗户边 */
  var acs = [];
  for (r = 2; r <= Math.min(ROWS - 6, 7); r++) {
    acs.push([1, r]); acs.push([2, r]); acs.push([3, r]);
  }
  var as = collect(acs, nAc, used);
  for (i = 0; i < as.length; i++) put(as[i][0], as[i][1], 'ac');

  /* ---------- V1.5 第三阶段：把黄金后排确定性补足 ----------
   * 手册的《后排统治者》要求「占 5 个黄金后排」，而 V1 全场只有 5 个 ——
   * 等于要求把整条后排全包下来，NPC 抢走一个就永远做不成。
   * 补到 9 个（紧凑 7 个）之后，5/9 才是一个「难但做得到」的目标。
   *
   * 关键是这一段**不洗牌、不消耗任何随机数**：只在所有特殊座位都摆完之后，
   * 从后排右端往左扫，把还空着的普通座位按固定顺序标成黄金。
   * 于是 V1 的随机序列与地图骨架一点没动，NPC 的 bias 又只看坐标不看座位类型，
   * 整局走位与 V1 逐帧一致 —— 只有后排多了几个金色座位。 */
  var wantGold = Math.max(7, Math.round(9 * k));
  for (c = COLS - 6; c >= 1 && haveGold < wantGold; c--) {
    var gi = I(c, ROWS - 1);
    if (grid[gi].aisle || used[gi] || grid[gi].type !== 'normal') continue;
    grid[gi].type = 'gold';
    used[gi] = true;
    haveGold++;
  }

  /* V2 第四节的特殊座位。放在**所有随机都结束之后**，固定顺序扫描、不洗牌、不消耗随机数
     —— 和上面那段黄金后排补足是同一个手法，这样开关关掉时地图骨架与 V1 逐格相同。 */
  if (V2_SEATS_ON) {
    placeV2Seats();
  } else {
    /* 关掉时把两个记录点清空：否则会留着上一局（或演示局）的坐标，
       虽然 updateV2Seats 在关掉时不会跑，但留着脏状态迟早坑到人。 */
    kingCell = null;
    coupleCells = [];
  }

  /* 阶段 5：争夺中心。放在**最后** —— 前面所有摆放和随机消耗都已结束，
     这一段只按坐标写 type，一个 Math.random() 都不掷（见 placeCenterSeats 注释）。 */
  placeCenterSeats();
}

/* ---------- V2 第四节：王者后排 + 情侣座 ----------
 * 两处都是「确定性摆放」：固定扫描顺序 + 平手取小下标，一个骰子都不掷。
 * 王者后排是从已有黄金座里**升级**一个（不新增座位），所以后排的「值钱感」更集中，
 * 而不是又多出一类座位。 */
var kingCell = null;      /* [c, r]，全场唯一；没有则为 null */
var coupleCells = [];     /* [[c,r],[c,r]]，成对的两格；没有则为空数组 */

/* ===== V36 下一阶段 · 阶段 5：让双人地图形成「争夺中心」（2026-10-18） =====
 * 文档：「高价值座位不要全部分布在地图边缘」「第一版只需要形成明确争夺中心」。
 *
 * 做法：在**两名玩家起点的中点**周围开一片 `CENTER_BAND_W × CENTER_BAND_H` 的带子，
 *       把带子里所有「普通座位」升级成「中央区」（60 分，见 SEAT.center）。
 *
 * · 以**两人中点为心**、不是以地图中心为心：双人默认起点在 0.26 / 0.74 宽度处
 *   （中点≈14 列），纯真人实验模式在 8 / 14 列（中点=11 列）。用地图中心的话，
 *   总有一侧玩家天然更近 —— 那就不叫公平的争夺中心了。
 * · **确定性扫描、零随机消耗**（和「黄金后排确定性补足」同一手法）：
 *   只按坐标遍历 + 写 `type`，一个 `Math.random()` 都不掷
 *   → 随机序列、NPC 走位与改动前逐帧一致，只有地图上多了几个紫色座位。
 * · **只在双人生效**：单人保持 v36 原样（单人没有「和谁争」的问题）。
 * · 清理区域会自然落到这片上 —— 因为阶段 2 的窗口选的是「已占座位最多的 5×5」，
 *   而两人开局就往中心抢，最挤的一片自然就是中心。这一点由探针实测确认，不靠假设。
 *
 * ⚠️ 进收敛组：V1.5 基线把它关掉 → `--events` / `--v2` 两份老基线继续有效。 */
var CENTER_CONTEST_ON = true;
var CENTER_BAND_W = 5;        /* 中心带宽（列） */
var CENTER_BAND_H = 3;        /* 中心带高（行） */

/* 返回放了几格（探针与报告要用；纯读，不改状态之外的东西） */
function placeCenterSeats() {
  if (!CENTER_CONTEST_ON || !isVersus()) return 0;

  var h0 = humanHome('versus', 0), h1 = humanHome('versus', 1);
  if (!h0 || !h1) return 0;
  /* ⚠️ 用**浮点中点**、不用取整后的中点 —— 两个走道列的间距可能是奇数
     （图书馆 12/17 → 中点 14.5、食堂 10/17 → 13.5），取整会让中央区整体偏一侧，
     一侧玩家天然更近（第一版就是这样，量出 6 vs 4 格）。 */
  var mc = (h0[0] + h1[0]) / 2;
  var mr = (h0[1] + h1[1]) / 2;
  var halfW = (CENTER_BAND_W - 1) / 2, halfH = (CENTER_BAND_H - 1) / 2;
  var cLo = Math.ceil(mc - halfW), cHi = Math.floor(mc + halfW);
  var rLo = Math.ceil(mr - halfH), rHi = Math.floor(mr + halfH);
  var n = 0, c, r, i, t;

  for (r = rLo; r <= rHi; r++) {
    for (c = cLo; c <= cHi; c++) {
      if (!inB(c, r)) continue;
      i = I(c, r); t = grid[i];
      if (t.aisle) continue;
      if (t.type !== 'normal') continue;   /* 不覆盖黄金后排 / 插座位等已有特殊座 */
      t.type = 'center';
      n++;
    }
  }
  return n;
}

function placeV2Seats() {
  kingCell = null;
  coupleCells = [];

  var mid = Math.floor(COLS / 2);
  var off, i, c, k;

  /* --- 王者后排：从后排正中间往两边扫，取第一个还是 gold 的格子升级成 king --- */
  for (off = 0; off < COLS && !kingCell; off++) {
    var cands = off === 0 ? [mid] : [mid - off, mid + off];
    for (i = 0; i < cands.length && !kingCell; i++) {
      c = cands[i];
      if (!inB(c, ROWS - 1)) continue;
      k = I(c, ROWS - 1);
      if (grid[k].aisle) continue;
      if (grid[k].type === 'gold') {
        grid[k].type = 'king';
        kingCell = [c, ROWS - 1];
      }
    }
  }
  /* 兜底：后排一个黄金座都没有（理论上不会，但别让王座凭空消失）——
     退而求其次，取最靠近正中的空普通座位。 */
  if (!kingCell) {
    for (off = 0; off < COLS && !kingCell; off++) {
      var cd = off === 0 ? [mid] : [mid - off, mid + off];
      for (i = 0; i < cd.length && !kingCell; i++) {
        c = cd[i];
        if (!inB(c, ROWS - 1)) continue;
        k = I(c, ROWS - 1);
        if (grid[k].aisle || grid[k].type !== 'normal') continue;
        grid[k].type = 'king';
        kingCell = [c, ROWS - 1];
      }
    }
  }

  /* --- 情侣座：成对出现。从倒数第二排往前、每排从左往右扫，
         取第一对「左右相邻、都还是普通座位」的格子。
         放在后排附近，和「情侣都爱坐后排」的校园梗对得上，也让它有抢的价值。 --- */
  var r, c2;
  for (r = ROWS - 2; r >= 1 && !coupleCells.length; r--) {
    for (c2 = 1; c2 < COLS - 1 && !coupleCells.length; c2++) {
      var a = I(c2, r), b = I(c2 + 1, r);
      if (grid[a].aisle || grid[b].aisle) continue;
      if (grid[a].type !== 'normal' || grid[b].type !== 'normal') continue;
      grid[a].type = 'couple';
      grid[b].type = 'couple';
      coupleCells = [[c2, r], [c2 + 1, r]];
    }
  }
}

/* ---------- V2 第四节：特殊座位的持续产出 ----------
 * 手册：「黄金插座区：持续产生奖励」「双人情侣座：合作占领获得额外奖励」。
 *
 * ⚠️ 整段不消耗任何 Math.random()，也不改任何模拟字段 ——
 *    只读 grid、写 actor.score。所以它不会打乱 NPC 走位。
 *    （score 本身在指纹的 core 签名里，所以这一节必须挂在 V2_SEATS_ON 下，
 *     否则 V1 档的哈希会变。） */
var v2PlugTick = 0;

function v2Reset() {
  v2PlugTick = 0;
}

function updateV2Seats(dt) {
  if (!V2_SEATS_ON || state !== 'play') return;

  var hi, i, t, a;

  /* --- 情侣座：两格都被人占下就发奖励。每帧只查两格，开销可忽略。
         同一格被同一个人全包、还是两个人各占一格（真·合作）都算。
         用 actor.coupleDone 记账，一对只发一次。 --- */
  if (coupleCells.length === 2) {
    var o0 = grid[I(coupleCells[0][0], coupleCells[0][1])].owner;
    var o1 = grid[I(coupleCells[1][0], coupleCells[1][1])].owner;
    if (o0 && o1) {
      for (hi = 0; hi < humans.length; hi++) {
        a = humans[hi];
        if (a.coupleDone) continue;
        if (o0 !== a.id && o1 !== a.id) continue;
        a.coupleDone = true;
        a.score += COUPLE_BONUS;
        addFloat(CX(coupleCells[0][0]), CY(coupleCells[0][1]) - 40,
          '💞 情侣座成套 +' + COUPLE_BONUS, '#C2185B', FS('fM'), 1.6);
      }
    }
  }

  /* --- 黄金插座区：每 PLUG_TICK 秒按「已占插座位数量」产出一笔奖励 ---
   * B（2026-10-04）：默认**暂停**。文档要求「得分主要来自继续抢座的行动」——
   * 开局抢到一个插座就一直挂机产分，会削弱走位抢座的意义，落后的人也追不回来。
   * 插座的价值改由「抢到那一刻的 seatType 溢价 + 连击 + 场景加成」一次性结算
   * （见 SEAT.plug / libClaimBonus / dineClaimBonus），所以停掉它不损失任何玩法。
   * ⚠️ 这一段**零随机消耗**，开关关掉时逐字回到 V1.5（v2PlugTick 照常累加、到点结算）。 */
  if (!PLUG_TICK_ON) return;
  v2PlugTick += dt;
  if (v2PlugTick < PLUG_TICK) return;
  v2PlugTick -= PLUG_TICK;

  for (hi = 0; hi < humans.length; hi++) {
    a = humans[hi];
    var n = 0;
    for (i = 0; i < grid.length; i++) {
      t = grid[i];
      if (t.owner === a.id && t.type === 'plug') n++;
    }
    if (!n) continue;
    a.score += n * PLUG_TICK_SCORE;
    /* 飘在玩家自己头上，比飘在某个固定插座上更容易看懂「这是我的插座在产出」 */
    addFloat(CX(a.c), CY(a.r) - 34, '🔌 插座区 +' + (n * PLUG_TICK_SCORE), '#0B6E9E', FS('fM'), 1.3);
  }
}

function findFreeNear(c0, r0) {
  if (inB(c0, r0) && !grid[I(c0, r0)].owner) return { c: c0, r: r0 };
  for (var rad = 1; rad < 16; rad++) {
    for (var dc = -rad; dc <= rad; dc++) {
      for (var dr = -rad; dr <= rad; dr++) {
        if (Math.abs(dc) !== rad && Math.abs(dr) !== rad) continue;
        var c = c0 + dc, r = r0 + dr;
        if (inB(c, r) && !grid[I(c, r)].owner) return { c: c, r: r };
      }
    }
  }
  return { c: clamp(c0, 0, COLS - 1), r: clamp(r0, 0, ROWS - 1) };
}

/* 找一个离目标最近的空闲走道格，玩家和 NPC 都从走道进场 */
var startTaken = {};
function findAisleNear(c0, r0) {
  var best = null, bestD = 1e9;
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      if (!grid[I(c, r)].aisle) continue;
      if (startTaken[I(c, r)]) continue;
      var d = Math.abs(c - c0) + Math.abs(r - r0);
      /* 必须挑「紧挨座位」的走道格：站在走道十字路口上，一按方向键只会顺着
         走道跑，一个座位也抢不到。 */
      var nearSeat = false;
      for (var k = 0; k < 4; k++) {
        var nc = c + DIRS[k].dx, nr = r + DIRS[k].dy;
        if (inB(nc, nr) && !grid[I(nc, nr)].aisle) { nearSeat = true; break; }
      }
      if (!nearSeat) d += 100;
      if (d < bestD) { bestD = d; best = { c: c, r: r }; }
    }
  }
  if (!best) best = findFreeNear(c0, r0);
  startTaken[I(best.c, best.r)] = true;
  return best;
}

/* ---------- NPC 人设 ---------- */
var NPC_DEFS = [
  {
    id: 'n1', name: '学霸', emoji: '🤓',
    home: function () { return [Math.floor(COLS / 2), 2]; },
    lines: ['第一排还有位置！', '前排听得清楚！', '这个位置我预习过！'],
    bias: function (c, r) {
      return Math.max(0, 3 - r) * 0.55 - Math.max(0, r - 5) * 0.5;
    }
  },
  {
    id: 'n2', name: '摸鱼王', emoji: '😎',
    home: function () { return [COLS - 7, ROWS - 3]; },
    lines: ['最后一排是我的！', '后排才是人待的地方。', '这个角落没人看得见吧？'],
    bias: function (c, r) {
      return Math.max(0, r - (ROWS - 5)) * 0.55 - Math.max(0, (ROWS - 6) - r) * 0.5;
    }
  },
  {
    id: 'n3', name: '卷王', emoji: '📚',
    /* V2 第五节：手册要求「卷王：高速移动疯狂抢座」。
       pace 是**步进间隔倍率**（<1 = 走得更快），只在 V2_SEATS_ON 打开时生效 ——
       否则 NPC 走位与 V1 不同，V1 档指纹就保不住了。见下面 NPC 推进循环里的取用。 */
    pace: 0.72,
    home: function () { return [2, Math.floor(ROWS / 2) + 1]; },
    lines: ['这排我全要了！', '再抢一个就收手！', '谁都别想坐下！'],
    bias: function (c, r) {
      if (V2_SEATS_ON) {
        /* 见座就抢：只区分「座位 vs 走道」，走道减分。
           刻意不给具体座位类型加权 —— 于是它会把一路上的空座全部卷走，
           制造竞争和混乱，正是手册说的「不是复杂AI」。 */
        return grid[I(c, r)].aisle ? -0.55 : 0.35;
      }
      /* V2 关闭时退回 V1 的「电脑哥」：只对插座有偏好，行为与 V1 逐字一致 */
      var best = 99, i, p;
      for (i = 0; i < plugCells.length; i++) {
        p = plugCells[i];
        if (grid[I(p[0], p[1])].owner) continue;
        var d = Math.abs(p[0] - c) + Math.abs(p[1] - r);
        if (d < best) best = d;
      }
      return best <= 3 ? 1.1 : 0;
    }
  }
];

/* ==========================================================
 * 6. 开局 / 重开
 * ========================================================== */

function resetGame(isDemo) {
  demo = !!isDemo;

  buildGrid();
  placeSpecials();

  floats = []; parts = []; banners = []; bubbles = [];
  /* 计分项不用在这里清零 —— Actor 重建时自带全新的 0 值 */
  elapsed = 0; timeLeft = GAME_TIME;
  /* 最后 15 秒高潮的表现层标志也要跟着重置，否则重开一局会一上来就是「高潮」外观 */
  finalRush = false; finalRushTickAt = -1;
  shakeT = 0; bumpT = 0;
  camReady = false;                  /* 局部放大：下一局游玩时相机先 snap 到玩家 */
  tipTimer = 6; eggTimer = 0; alertTimer = 14;
  hintTile = -1; hintT = 0; tipN = 0;
  evReset();                        /* 校园事件系统：换一条新的随机流 */
  hotReset();                       /* 食堂热门位：换一条独立随机流，清掉上一局的热门位 */
  penReset();                       /* V1.6：惩罚特效的独立随机流也回到种子起点 */

  /* 人类玩家：单人 1 个、双人 2 个，各自从教室一侧的走道进场 */
  applyKeymaps();
  startTaken = {};
  actors = [];
  humans = [];
  var setup = HUMAN_SETUP[MODE] || HUMAN_SETUP.solo;
  for (var hi = 0; hi < setup.length; hi++) {
    var hHome = humanHome(MODE, hi);
    var hSpot = findAisleNear(hHome[0], hHome[1]);
    var hu = makeActor(setup[hi].id, 'human', {
      c: hSpot.c, r: hSpot.r, dir: DIRS[0],
      input: humanInputs[hi],
      name: setup[hi].name
    });
    applyRole(hu, rolePick[hi] || null);
    /* 联机时 2P 由网络驱动 */
    if (hi > 0 && isHost()) { hu.remote = true; hu.netHold = null; hu.netTap = null; }
    humans.push(hu);
    actors.push(hu);
  }
  player = humans[0];
  /* 任务系统放在 player 就位之后：任务进度要读 player.id / grid，
   * 太早调用会在第一局（player 还是 null）上直接炸掉。 */
  tasksReset();

  /* 室友（社交达人的召唤物）：新的一局清空，别把上局的跟班带进来 */
  helperReset();

  /* V2 第四节：插座区的产出计时器。新的一局从 0 开始，别把上局的余数带进来。 */
  v2Reset();

  /* 第六阶段：图书馆安静值 + 期末周加速。同样必须每局归零 ——
     不然上一局被管理员驱赶后剩的安静值会带进新一局，一开局就被赶一次。
     教室/食堂 SCENE.lib 为 null，这里只是把字段置 0，零副作用。 */
  libCalmResetAll();
  libFinalWeek = 0;

  /* 第七阶段：食堂的饭菜 / 排队长龙 / 新菜区域 / 开饭铃。
     同样必须每局归零 —— 上局排到 12 格的长龙带进新一局，开局就白送一个满倍率。
     教室/图书馆 SCENE.dine 为 null，这里只是把字段置 0，零副作用。 */
  dineResetAll();

  /* NPC —— 与玩家同一套 Actor，只是 kind 不同 */
  npcs = [];
  /* 阶段 4：纯真人实验模式（双人）→ 这一局**不建** NPC。
     ⚠️ 只跳过创建，NPC_DEFS / 行为代码一个字没删（铁律 3）；
        开关关掉时下面这段循环逐字不变 → 随机消耗与 v36 一致（铁律 1）。 */
  var noNpcThisRound = purePvpOn();
  if (!noNpcThisRound) {
  for (var i = 0; i < NPC_DEFS.length; i++) {
    var def = NPC_DEFS[i];
    var home = def.home();
    var spot = findAisleNear(home[0], home[1]);
    /* 注意：rand(4) 与 random() 的调用顺序必须与重构前一致，否则随机序列错位 */
    var n = makeActor(def.id, 'ai', {
      c: spot.c, r: spot.r,
      dir: DIRS[rand(4)],
      bubbleTimer: 2 + Math.random() * 6,
      name: def.name, emoji: def.emoji, lines: def.lines, bias: def.bias,
      /* V2 第五节：卷王走得更快。关掉 V2_SEATS_ON 时强制回 1 ——
         否则 NPC 步进节奏变了，V1 档的 core 哈希就对不上。 */
      pace: V2_SEATS_ON ? (def.pace || 1) : 1
    });
    npcs.push(n);
    actors.push(n);
  }
  }

  if (isDemo) {
    /* 演示模式：把 NPC 调快，让开场画面热闹起来 */
    for (i = 0; i < npcs.length; i++) npcs[i].stepTimer = Math.random() * 0.3;
  }

  /* 新手引导：只重置「本局要不要出」，不写存档（存档只在真正看完时写）。
     放在这里而不是 beginCountdown —— 演示局也走 resetGame，得一起管住。 */
  tutResetRound(isDemo);

  /* 阶段 10 前置：对局数据记录器。**必须每局归零** ——
     否则上一局的最大分差 / 反超次数会滚进下一局，《V36 对局数据报告》直接失真。
     放在这里而不是开头：它不读任何模拟状态，只是新建一个空对象，位置无副作用；
     放在结尾是为了让「这一局要用到的东西全都建好了」这件事在阅读顺序上成立。 */
  recReset();

  buildBackground();
  syncHud(true);
}

/* ==========================================================
 * 7. 输入
 * ========================================================== */

function onKeyDown(e) {
  var k = (e.key || '').toLowerCase();

  /* 规则面板开着时它独占键盘：Esc / 空格 / 回车关掉，其余键一律吞掉，
     免得「在规则页里按空格」顺手把一局开起来。
     放在最前面（连 M 键都在它后面）就是为了这条。 */
  if (rulesShown) {
    if (k === 'escape' || k === ' ' || k === 'enter') { e.preventDefault(); hideRules(); }
    return;
  }

  if (k === 'm') { toggleSound(); return; }

  /* 暂停快捷键（2026-10-10）。位置在规则页之后、其余一切之前：
     · 暂停时：空格 / Esc / P 都用来「继续」——这三个都是玩家最容易顺手按的；
     · 未暂停时：空格 / Esc / P 都用来「暂停」，但**只在真正对局中**才吃这三个键
       （canPause() 已经是这个判据），否则会把开始页的「空格开局」和结算页的
       「空格重开」抢掉。
     顺序很关键：必须排在下面 `state === 'start'` / `'over'` 那两个分支之前，
     但又必须用 canPause() 把自己限制在这两个状态之外，两者正好不冲突。 */
  if (PAUSED) {
    if (k === ' ' || k === 'escape' || k === 'p') { e.preventDefault(); setPaused(false); return; }
    /* 暂停时其余按键一律吞掉：不许放技能、不许让角色继续走 */
    if (KEYMAP_SOLO[k] || SKILL_KEYS[k]) { e.preventDefault(); return; }
  } else if (canPause() && (k === ' ' || k === 'escape' || k === 'p')) {
    e.preventDefault(); setPaused(true); return;
  }

  /* T：手动切换移动端触摸 UI（桌面预览用） */
  if (k === 't' && !KEYMAP_SOLO[k]) {
    touchOverride = !isTouch;
    detectTouch();
    return;
  }

  if (state === 'start' && (k === ' ' || k === 'enter')) { e.preventDefault(); beginCountdown(); return; }
  if (state === 'over' && (k === ' ' || k === 'enter')) { e.preventDefault(); restart(); return; }

  /* 技能键：1P 用 Q，2P 用 L（R3.3；原来的 , 换成 L，理由见 SKILL_KEYS 上方注释）。
     V1.6 第二阶段：第二槽的 E / . 已从 SKILL_KEYS 摘掉，这里不用再判 slot。

     R3.3 加固：2P 的技能必须是**本地的人类 2P** 才响应。
     联机客机（isGuest）上 humans[1] 是房主那边同步过来的远程角色，
     客机按 L 不该驱动它 —— 沿用原来 isGuest() 一律走网络请求的分支，行为不变；
     这里只是把「不存在的玩家」挡住（单人时 humans 只有 1 个，按 L 静默忽略）。 */
  var sk = SKILL_KEYS[k];
  if (sk) {
    var who = humans[sk.p];
    if (who) {
      e.preventDefault();
      if (isGuest()) netRequestSkill(sk.slot);
      else useSkill(who, sk.slot);
    }
    return;
  }

  /* 按键按各自的键表分发给对应玩家（双人时 WASD 归 1P、方向键归 2P） */
  for (var i = 0; i < humans.length; i++) {
    var inp = humans[i].input;
    var d = inp.map[k];
    if (!d) continue;
    e.preventDefault();
    inp.down(d);
    return;
  }
}

function onKeyUp(e) {
  var k = (e.key || '').toLowerCase();
  for (var i = 0; i < humans.length; i++) {
    var inp = humans[i].input;
    var d = inp.map[k];
    if (!d) continue;
    inp.up(d);
    return;
  }
}

function clearKeys() {
  for (var i = 0; i < humanInputs.length; i++) humanInputs[i].clear();
}

/* ==========================================================
 * 7b. 触摸控制：虚拟摇杆 + 手指滑动
 * ========================================================== */

var isTouch = false;
var joyEl = null, joyKnob = null;
var joyPointer = null;
var swipeState = null;

/* 触摸 UI 支持手动开关，方便在桌面预览：
 *   - 按 T 键切换
 *   - URL 加 ?touch=1 / ?touch=0 强制开关（手机分享测试链接时很有用） */
var touchOverride = null;

function readTouchOverride() {
  try {
    var loc = window.location;
    if (!loc) return null;
    var m = /[?&]touch=(0|1)/.exec(loc.search || '');
    if (m) return m[1] === '1';
    if (/touch/.test(loc.hash || '')) return true;
  } catch (e) {}
  return null;
}

function detectTouch() {
  if (touchOverride === null) touchOverride = readTouchOverride();
  var nav = window.navigator || {};
  var auto = !!(
    ('ontouchstart' in window) ||
    (nav.maxTouchPoints > 0) ||
    (nav.msMaxTouchPoints > 0)
  );
  isTouch = (touchOverride === null) ? auto : touchOverride;
  if (stage.classList) stage.classList.toggle('touch', isTouch);
  var rh = document.getElementById('rotate-hint');
  if (rh && rh.classList) rh.classList.toggle('show', isTouch && isPortrait());
  return isTouch;
}

function isPortrait() {
  var vp = viewportSize();
  return vp.h > vp.w * 1.05;
}

/* ---------- 一键横屏 ----------
 * 浏览器的规矩：**不允许网页主动转屏**，必须先进入全屏，才能用 Screen Orientation API 锁定方向。
 * iOS Safari 两个 API 都不支持，所以失败时要明确告诉用户手动转，而不是让他干等。 */
function canLockLandscape() {
  var el = document.documentElement;
  var canFs = !!(el && (el.requestFullscreen || el.webkitRequestFullscreen ||
                        el.mozRequestFullScreen || el.msRequestFullscreen));
  var scr = window.screen || {};
  var canLock = !!((scr.orientation && scr.orientation.lock) || scr.lockOrientation ||
                   scr.mozLockOrientation || scr.msLockOrientation);
  return canFs && canLock;
}

/* 转屏 + 全屏生效需要时间，多刷几次布局，别只刷一次 */
function afterRotate() {
  setTimeout(onViewportChange, 120);
  setTimeout(onViewportChange, 420);
  setTimeout(onViewportChange, 900);
}

function tryLandscape() {
  var el = document.documentElement;
  var scr = window.screen || {};
  var pending = [];

  try {
    if (el.requestFullscreen) pending.push(el.requestFullscreen({ navigationUI: 'hide' }));
    else if (el.webkitRequestFullscreen) pending.push(el.webkitRequestFullscreen());
    else if (el.mozRequestFullScreen) pending.push(el.mozRequestFullScreen());
    else if (el.msRequestFullscreen) pending.push(el.msRequestFullscreen());
  } catch (e) {}

  try {
    if (scr.orientation && scr.orientation.lock) pending.push(scr.orientation.lock('landscape'));
    else if (scr.lockOrientation) pending.push(scr.lockOrientation('landscape'));
    else if (scr.mozLockOrientation) pending.push(scr.mozLockOrientation('landscape'));
    else if (scr.msLockOrientation) pending.push(scr.msLockOrientation('landscape'));
  } catch (e) {}

  var waited = 0;
  for (var i = 0; i < pending.length; i++) {
    if (pending[i] && pending[i].then) {
      waited++;
      pending[i].then(afterRotate, afterRotate);
    }
  }
  if (!waited) afterRotate();
  return waited > 0;
}

function setRotateTip(text, warn) {
  var tip = document.getElementById('rotate-tip');
  if (!tip) return;
  tip.textContent = text;
  if (tip.classList) tip.classList.toggle('warn', !!warn);
}

/* 竖屏提示里的「一键横屏」按钮 */
function initRotateUI() {
  var btn = document.getElementById('btn-rotate');
  if (canLockLandscape()) {
    setRotateTip('会自动进入全屏并锁定横屏', false);
  } else {
    setRotateTip('这台设备不支持自动横屏，请手动把手机转过来', true);
  }
  if (!btn || !btn.addEventListener) return;

  btn.addEventListener('click', function () {
    var ok = tryLandscape();
    setRotateTip(ok ? '正在切换到横屏…' : '这台设备不支持自动横屏，请手动把手机转过来', !ok);
    if (!ok) return;
    /* 1.2 秒后看结果：还是竖屏就说明没锁成功，老实告诉用户 */
    setTimeout(function () {
      if (isPortrait()) setRotateTip('没能自动转屏，请手动把手机横过来', true);
      else setRotateTip('已切到横屏，开抢吧！', false);
    }, 1200);
  });
}

/* 把向量转成四个方向里最接近的那个 */
function dirFromVector(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

/* ---------- 虚拟摇杆：一个玩家一根 ---------- */
var joySticks = [];

function setKnob(st, dx, dy) {
  if (st.knob && st.knob.style) {
    st.knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
  }
}

/* 手指按住时给摇杆加 .drag，CSS 那边把底座压淡 —— 拇指本来就盖住了那块，
   底座再实心就彻底看不见底下的座位了。只切一个 class，不碰任何模拟字段。 */
function setStickDrag(st, on) {
  var el = st && st.el;
  if (el && el.classList) el.classList.toggle('drag', !!on);
}

function stickUpdate(st, clientX, clientY) {
  if (!st.el || !st.el.getBoundingClientRect) return;
  var r = st.el.getBoundingClientRect();
  if (!r.width) return;
  setStickDrag(st, true);
  var dx = clientX - (r.left + r.width / 2);
  var dy = clientY - (r.top + r.height / 2);
  var dist = Math.sqrt(dx * dx + dy * dy);
  var radius = r.width / 2;
  if (dist < radius * 0.22) {          /* 死区：手指在中心附近就不动 */
    st.input.setHold('joy', null);
    setKnob(st, 0, 0);
    return;
  }
  st.input.setHold('joy', dirFromVector(dx, dy));
  var k = Math.min(dist, radius * 0.6) / (dist || 1);
  setKnob(st, dx * k, dy * k);
}

function stickRelease(st) {
  st.pointer = null;
  st.input.setHold('joy', null);
  setKnob(st, 0, 0);
  setStickDrag(st, false);
}

function bindStick(elId, knobId, input) {
  var el = document.getElementById(elId);
  var knob = document.getElementById(knobId);
  if (!el || !el.addEventListener) return null;
  var st = { el: el, knob: knob, input: input, pointer: null };

  el.addEventListener('touchstart', function (e) {
    if (e.preventDefault) e.preventDefault();
    if (st.pointer !== null) return;              /* 一根摇杆只跟一根手指 */
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    st.pointer = t.identifier;
    stickUpdate(st, t.clientX, t.clientY);
  }, { passive: false });

  el.addEventListener('touchmove', function (e) {
    if (e.preventDefault) e.preventDefault();
    var list = e.changedTouches || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].identifier === st.pointer) stickUpdate(st, list[i].clientX, list[i].clientY);
    }
  }, { passive: false });

  function end(e) {
    var list = e.changedTouches || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].identifier === st.pointer) stickRelease(st);
    }
  }
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);

  /* 桌面也能用鼠标拖摇杆，方便调试 */
  el.addEventListener('mousedown', function (e) {
    if (e.preventDefault) e.preventDefault();
    st.pointer = 'mouse';
    stickUpdate(st, e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', function (e) {
    if (st.pointer === 'mouse') stickUpdate(st, e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', function () {
    if (st.pointer === 'mouse') stickRelease(st);
  });

  return st;
}

function pointInAnyStick(t) {
  for (var i = 0; i < joySticks.length; i++) {
    var el = joySticks[i].el;
    if (!el || !el.getBoundingClientRect) continue;
    var r = el.getBoundingClientRect();
    if (!r.width) continue;
    if (t.clientX >= r.left && t.clientX <= r.right &&
        t.clientY >= r.top && t.clientY <= r.bottom) return true;
  }
  return false;
}

function bindTouch() {
  joySticks = [];
  var s1 = bindStick('joystick', 'joy-knob', humanInputs[0]);
  if (s1) joySticks.push(s1);
  var s2 = bindStick('joystick2', 'joy-knob2', humanInputs[1]);
  if (s2) joySticks.push(s2);

  /* ---------- 教室区域滑动 ----------
   * 只在单人模式启用：双人时两个人各用各的摇杆，滑动分不清是谁。 */
  stage.addEventListener('touchstart', function (e) {
    var t = e.changedTouches && e.changedTouches[0];
    if (!t || swipeState || isVersus() || pointInAnyStick(t)) return;
    swipeState = {
      id: t.identifier,
      x0: t.clientX, y0: t.clientY,
      x: t.clientX, y: t.clientY,
      t0: performance.now()
    };
  }, { passive: true });

  stage.addEventListener('touchmove', function (e) {
    if (!swipeState) return;
    var list = e.changedTouches || [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.identifier !== swipeState.id) continue;
      swipeState.x = t.clientX;
      swipeState.y = t.clientY;
      var dx = t.clientX - swipeState.x0, dy = t.clientY - swipeState.y0;
      if (Math.sqrt(dx * dx + dy * dy) > 16) {
        humanInputs[0].setHold('drag', dirFromVector(dx, dy));
      }
    }
  }, { passive: true });

  function swipeEnd(e) {
    if (!swipeState) return;
    var list = e.changedTouches || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].identifier !== swipeState.id) continue;
      var dx = swipeState.x - swipeState.x0;
      var dy = swipeState.y - swipeState.y0;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var dur = performance.now() - swipeState.t0;
      if (dist > 16) {
        humanInputs[0].setTap(dirFromVector(dx, dy));
      } else if (dist < 10 && dur < 320 && player && player.dir) {
        humanInputs[0].setTap(player.dir.n);
      }
      swipeState = null;
      humanInputs[0].setHold('drag', null);
    }
  }
  stage.addEventListener('touchend', swipeEnd);
  stage.addEventListener('touchcancel', swipeEnd);

  stage.addEventListener('contextmenu', function (e) {
    if (isTouch && e.preventDefault) e.preventDefault();
  });
}

/* ==========================================================
 * 8. 占座核心
 * ========================================================== */

function isContested(c, r, who) {
  if (!who || !who.alive) return false;
  var dp = Math.abs(c - who.c) + Math.abs(r - who.r);
  if (dp > 3) return false;
  for (var i = 0; i < actors.length; i++) {
    var o = actors[i];
    if (o === who || o.kind !== 'ai' || o.blocked) continue;
    if (Math.abs(c - o.c) + Math.abs(r - o.r) <= 3) return true;
  }
  return false;
}

/* ---------- 占座：通用部分 ----------
 * 只做「这格归谁」这件所有占座者共有的事；
 * 分数、连击、飘字、音效这些因人而异的反馈，交给下面的两个分支。
 *
 * `viaHelper` 两种取值（阶段 8 追加 R3.2，2026-10-22）：
 *   `true`  = 室友**踩到就占**的那一格（最常见的替占，见 updateHelpers「踩上就占」）；
 *   `'walk'`= 室友**只经过、没停下**的那一格（见 helperWalkClaim）。
 *   两者都让 `t.hm = 2`（「这一格是室友帮你拿的」），区别只在 `t.hmh`：
 *   `1` = 刚经过（0.6 秒内还会闪一下，提示「刚拿下的」）；
 *   `0` = 已经站定了。
 *   ⚠️ 为什么不用 `1/2 两档` 记「谁拿的」：用户只要一个语义 ——「室友经过就算我的」。
 *      两档会让玩家去猜「为什么这两格画得不一样」，而差别他根本无从知道。
 *   `t.hm` 是纯数据，指纹 gridSig 只读 owner/type/item → 不影响任何一档指纹。
 *
 * 第 5 个参数 `silent`：**只给测试台的单格调试用**，游戏里没有任何调用点传它。
 *   原因：真机里 `claimTile` 走的是**全局** `player`，会把一局真人局打出计分/特效，
 *   单格用例就没有干净的期望值可比。`silent === true` → 只写 grid、不走反馈。 */
/* 测试台钩子（2026-10-22）：默认 null，游戏里永远是 null。 */
var claimFeedbackOverride = null;

function claimTile(c, r, actor, viaHelper, silent) {
  var t = grid[I(c, r)];

  t.owner = actor.id;
  t.item = st(pick(ITEMS));
  t.anim = 1;
  t.claimAge = 0;
  /* 阶段 8 追加 R3：记下「这一格是室友替我拿的」。**唯一写入点** ——
     清空座位（清理事件 / 交换事件 / 图书馆赶人）不会把它留着，因为
     绘制只对 `t.owner` 为真的格子跑（drawSeatDynamic），而任何一次重新占座
     都会再走一遍这里把 hm 覆盖成 0/2。纯数据，零随机消耗。
     ⚠️⚠️ 2026-10-22 R3.2 修：这里**不能写 `viaHelper ? 2 : 0`** ——
        `'walk'` 是真值，会让「路过」那批也标成 hm=2。R3.2 之前这两种
        「室友拿的」本来就该一样，所以第一版写 `viaHelper ? 2 : 0` 是对的；
        R3.2 给了 `'walk'` 一层「不计分」的语义（见下面的 early return），
        于是「hm 有没有写」和「走不走反馈」变成两件独立的事，判断必须各自写全。
        现在：hm 只认 `true`（踩上就占）；`'walk'` 只写 hmh（刚经过的高亮）。 */
  t.hm = viaHelper ? 2 : 0;
  /* 阶段 8 追加 R3.2：`hmh` = 是不是「刚经过」的那一格（0.6 秒的经过高亮用它）。
     ⚠️ 必须**每次都写**（不只 viaHelper 时写）—— 否则格子先被室友占下、
     后来被清理抹掉、又被玩家自己占回来时，这里会残留上一轮的 1（脏数据）。
     这与 `hm` 写成 `(viaHelper === true) ? 2 : 0`、而不是「只在为真时赋值」是同一个道理。 */
  t.hmh = viaHelper ? 1 : 0;

  var def = SEAT[t.type];
  /* 联机：房主负责把占座事件同步给访客（访客端不跑模拟）。
     `h` = 这一格是室友替占的（阶段 8 追加 R3）—— 老客户端会忽略这个字段，
     访客端读不到时按 0 处理，所以加字段是向后兼容的。 */
  if (isHost() && Net.connected()) Net.send({ t: 'c', i: I(c, r), o: actor.id, it: t.item, h: (viaHelper === true) ? 2 : 0, w: viaHelper ? 1 : 0 });
  /* ⚠️⚠️ 阶段 8 追加 R3.2：这里**必须写 `viaHelper !== 'walk'` 的完整判断，不能写 `if (viaHelper)`** ——
     `'walk'` 是个**真值**，写 `if (viaHelper)` 会让「路过占下的格子」走计分那条路，
     「路过不计分」当场失效（2026-10-22 第一版就是这么写的，探针 7D.25 的读数
     「开 72.6 分/格 vs 关 79.9 分/格」只差 7 分，就是每格都偷偷加了分）。
     JS 里字符串永远是真值 —— 这类「用字符串当标记位」的写法，每个 `if` 都要重看一遍。 */
  if (viaHelper === 'walk' || silent === true) {
    /* 测试台钩子：默认 null，游戏里恒不进这个分支里的那一行。 */
    if (claimFeedbackOverride) claimFeedbackOverride(c, r, actor, viaHelper);
    return;
  }
  if (actor.kind === 'ai') claimFeedbackAi(actor, t, def, c, r);
  else claimFeedbackPlayer(actor, t, def, c, r, viaHelper);
}


/* 测试台钩子（2026-10-22 R3.2）：**占座结果**的另一半闸门，默认 null。
 * 为什么需要（真实踩过 40 分钟）：为了让「静默占座」只写 grid 不走反馈，
 * 探针会传一个**临时对象**当 actor；而计分路径里到处是「你是不是那个真玩家」
 * 的判定（`actor === player` 一类）。临时对象永远过不了，
 * 于是 `claimTile` 把 `t.owner` 写上了、反馈层又把它悄悄复原 ——
 * 表现就是「格子被占了又自己变回空的」，而 `helperWalkClaim` 返回的 `got` 却已经 +1。
 * 这类 bug 最阴的地方：所有**返回值和计数**都是对的，只有 grid 是错的。
 * 现在把「占座时要不要走计分反馈」这一层的判定做成可注入：
 * 游戏里恒 null → 逐字退回原判定，行为与线上完全一致。 */
var claimOwnerGate = null;

/* ---------- 占座反馈：人类玩家 ---------- */
function claimFeedbackPlayer(actor, t, def, c, r, viaHelper) {
  var x = CX(c), y = CY(r);
  /* ⚠️ 阶段 8 追加 R3.2：「路过替占」的格子**不计分、不飘字、不弹特效**。
     放在函数最前面、在计分之前 —— 早退比一堆 `if (viaHelper === 'walk')` 干净。
     （顺带说明为什么不能只在这一层挡：`claimFeedbackPlayer` 前面还有
      `actor.claimCount` / 插座任务 / Combo 这一串副作用，全都不该为「路过」发生。）
     ⚠️ 只在 `render` / `update` 之外读状态，不消耗随机数 —— 铁律 1 不受影响。 */
  if (viaHelper === 'walk') return;
  /* 测试台钩子：默认 null，游戏里**永远不进这个分支**（执行到这里就走不动了）。
     `claimOwnerGate` 为真 = 探针传了个临时 actor 造局，只想要「格子归谁」这个结果；
     再往下走会让 `Math.random()` 序列错位（`st(pick(ITEMS))`、飘字样式），
     所以必须在这里截断，而不是在下面某一行。 */
  if (claimOwnerGate && claimOwnerGate(actor)) return;
  /* 累计占座次数（只增不减）。放在函数最前面，室友替占（viaHelper）也算 ——
     对玩家来说「这格是我的了」这件事是一样的。纯计数，不消耗随机数。 */
  actor.claimCount = (actor.claimCount || 0) + 1;
  /* C：插座任务的「本局累计不同插座」。同一个格子反复抢只记一次 ——
     清理把 owner 抹掉之后再抢回来，进度也不会重复增加（文档要求）。
     纯对象读写，零随机消耗；开关关掉时连这一行都不进。 */
  if (TASK_PLUG_CUMUL_ON && t.type === 'plug') {
    var pk = I(c, r);
    if (!plugClaimedSet[pk]) { plugClaimedSet[pk] = 1; plugClaimedCount++; }
  }
  /* 1B：读的还是裸挂钟 —— 暂停时长已经在「恢复」那一刻补进 lastClaimAt（见 setPaused）。 */
  var now = performance.now();
  /* E：负分座位是**纯惩罚**。先判一次，后面三处（连击 / 连击奖励 / 区域加成）都短路。
     判定只用 def.score，不碰任何随机数；开关关掉时 negSeat 恒为 false ⇒ 逐字回旧行为。 */
  var negSeat = NEG_SEAT_PURE_ON && def.score < 0;
  if (negSeat) {
    /* ① 不加连击、也不刷新连击 —— `lastClaimAt` 也不动，
       让原有连击继续按「原来的超时规则」结束（评审原话）。 */
  } else {
    if (now - actor.lastClaimAt < COMBO_WINDOW) actor.combo++; else actor.combo = 1;
    actor.lastClaimAt = now;
  }
  if (actor.combo > actor.maxCombo) actor.maxCombo = actor.combo;

  var contested = t.contest;
  /* ② 负分座不吃连击奖励（否则「高连击踩负分」反而可能是正收益） */
  var bonus = negSeat ? 0 : Math.min(actor.combo - 1, 12) * COMBO_STEP;
  var base = def.score;

  /* 第四阶段起角色不再有「前排 / 后排 +30%」这类纯数值被动 ——
   * 手册批评的正是「角色差异只有数值变化」，四个角色的区别改由招牌技能体现（见 ROLES）。
   * 这里留作扩展点：以后要加计分型被动（比如学霸对特殊座位的加成）就挂在这一行。 */
  /* ===== 2026-09-19 角色「签名被动」：让四个角色的玩法区别更大、更明确 =====
   * 用户反馈「不同角色功能区别还是不大」。下面四条全是纯算术，
   * 不消耗任何随机数（Math.random / evRand / taskRand 一个都没碰），
   * 所以不影响指纹可复现性；而且指纹基线里角色恒为 null，这四条对回归零影响。 */
  /* ⚠️ E：负分座上，这些被动一律**不参与** —— 学霸的 +50% / 行动派的连击翻倍都是「正向加成」，
     按评审原文「不叠加连击、区域等正向奖励」应当全部中和；只有「免罚」这一个负分相关被动保留
     （且它只把 `base` 归零，不给正收益）。`negSeat` 为 false 时以下行为一字不改。 */
  if (negSeat) {
    /* 纯惩罚：base 就是座位原分值（-30），bonus 已在上面置 0 */
  } else {
    if (actor.role && actor.role.id === 'scholar' && t.type !== 'normal') base *= 1.5;   /* 学霸：特殊座位 +50% */
    if (actor.role && actor.role.id === 'doer') bonus *= 2;                              /* 行动派：连击奖励翻倍 */
  }
  if (actor.role && actor.role.id === 'slacker' && base < 0) base = 0;                 /* 摸鱼大师：负分座位免疫（只免扣分） */
  /* 临时抱佛脚：下一次特殊座位翻倍（只翻正收益，别把负分也翻倍） */
  if (actor.cram && t.type !== 'normal') {
    if (def.score > 0) base *= 2;
    actor.cram = false;
    addFloat(x, y - 46, '抱佛脚生效！', '#7B4B00', FS('fS'), 1.3);
  }
  var gain = base + bonus;
  /* 图书馆三区域加成（安静区高分 / 插座区插座位溢价 / 讨论区额外分）。
     纯算术、零随机消耗；教室与食堂进来第一行就返回。 */
  if (libOn()) gain = libClaimBonus(c, r, t, gain);
  /* 食堂：饭菜资源 + 排队长龙 + 窗边桌加成。
     ⚠️ 必须排在下面「热门位」结算**之前** —— 热门位一被占就从 hotCells 里摘掉了，
        之后 dineFoodOf 里那句 isHotCell 永远是 false，饭菜的 ×2 会静默失效。 */
  if (dineOn()) gain = dineClaimBonus(c, r, t, actor, gain);
  if (actor.role && actor.role.id === 'social' && viaHelper) gain += 15;              /* 社交达人：室友每占一座 +15 */
  /* 食堂热门位：占下额外 +bonus，然后从热门位上移除（教室 hot 是 null → 恒不触发） */
  var hotHit = false;
  if (SCENE.hot && isHotCell(c, r)) {
    gain += SCENE.hot.bonus; hotClear(c, r); hotHit = true;
    if (actor === player) tHotTaken++;      /* 食堂《抢热门菜》的进度，只算 1P 自己的 */
  }
  /* ③ 负分座**不吃任何区域加成**（评审：「不叠加连击、区域等正向奖励」）。
     ⚠️ 场景函数必须**照常调用**（`dineClaimBonus` 有副作用：入队、攒饭菜），
        所以这里不是「跳过调用」，而是**把结果压回纯惩罚值**（= `base`，此时 bonus 已被置 0）。
        免罚角色（摸鱼大师，`base` 已被归零）⇒ gain 也是 0：**只免扣分，不获得正收益**。 */
  if (negSeat) gain = base;
  actor.score = Math.max(0, actor.score + gain);
  actor.seatCount++;
  if (t.type !== 'normal') actor.specialCount++;
  /* 高光（第九阶段 P1-2）：连续特殊座位计数。纯自增 —— 不掷骰子、不参与任何判定，
     只在结算时被读一次，所以它不影响一局的走向（指纹回归可证）。 */
  if (t.type !== 'normal') {
    actor.spStreak = (actor.spStreak || 0) + 1;
    if (actor.spStreak > (actor.spBest || 0)) actor.spBest = actor.spStreak;
  } else {
    actor.spStreak = 0;
  }
  /* 小组讨论区：占一格就攒一次「讨论」，攒够 3 格追加一个额外任务。
     只对人类玩家生效（NPC 不进任务系统），且只在单人 + 任务开着时动手。 */
  if (inLibGroupZone(c, r)) libDiscussTick(actor);

  actor.claimFlash = 1;

  /* ---------- 飘字：V1.5 起「普通占座只更新 HUD」 ----------
   * 手册要求砍掉满屏的 +10，只保留特殊座位的弹窗。
   * 关键点：这段代码仍然照常执行（包括 Math.random 的抖动），只是给普通座位
   * 的飘分打上 'mute' 标记，由 drawFloats 跳过。
   * 为什么不直接删掉？因为 Math.random 的消耗顺序决定整局 NPC 的走位，
   * 动它会连带改变玩法 —— 改渲染不改模拟，回归指纹才能逐帧对上。 */
  var isBig = def.score >= 40 || def.score < 0;
  var isSpecial = t.type !== 'normal';
  /* 阶段 8 修（2026-10-20 用户试玩反馈 R2「室友帮忙占的时候……也没有加分」）：
   * **根因不是没加分，是加了看不见** —— V1.5 起普通占座的飘分一律打 'mute'，
   * 只在 HUD 上体现。而室友替占是「玩家没按键、被动发生」的事件，
   * 没有飘字就彻底没有反馈，玩家自然会以为「没加分」。
   * 所以：**viaHelper 的普通座也照常飘分**。只改这个标记，不改任何计分逻辑，
   * 也不动 Math.random 的调用序列（两处抖动照旧先执行）。 */
  addFloat(x + (Math.random() - 0.5) * 10, y - 26 + (Math.random() - 0.5) * 5,
    (gain >= 0 ? '+' : '') + gain,
    gain >= 0 ? '#D9480F' : '#1B7A3E', FS(isBig ? 'fL' : 'fM'),
    isBig ? 1.35 : 0.9,
    true, gain, (isSpecial || viaHelper) ? '' : 'mute');

  /* 食堂热门位：普通座位的飘分被 'mute' 掉了，所以那额外的 +60 得单独说一句，
   * 否则玩家只看到分数莫名变高，不知道「橙色那一格」值钱。
   * 只在 hotHit 为真时执行 —— 教室 hot 是 null，这条对老路径零影响。 */
  if (hotHit) addFloat(x, y - 48, '热门位 +' + SCENE.hot.bonus, '#E06A00', FS('fM'), 1.25);

  /* 「我占了！」只在开局前三下出现，V1.5 去掉 —— 它不消耗随机数，删掉是安全的。
   * 连抢提示保留（每 5 连给一次），因为普通座位不再飘分后，
   * 它是连击唯一的即时反馈，砍掉手感会变木。 */
  if (actor.combo >= 5 && actor.combo % 5 === 0) {
    addFloat(x, y + 22, '连抢 x' + actor.combo, '#C2185B', FS('fS'), 0.9);
  }

  /* 音效 */
  if (t.type === 'normal') {
    Sound.claim(actor.combo);
    addParticles(x, y + 8, 5, ['#F6D68A', '#FFE9B8', '#E6CE96'], 0.5);
  } else {
    Sound.special();
    addParticles(x, y, 22, [def.edge, '#FFD84D', '#FFFFFF', def.desk], 1.15);
    /* 特殊座位才弹横幅，1.5 秒后自动消失 */
    addBanner(def.icon, st(def.label) + '！ ' + (gain >= 0 ? '+' : '') + gain, st(def.toast),
      def.good ? 'good' : 'bad', 1.5);
    if (def.good) shake(3, 0.16);
  }

  /* 抢座冲突结果 */
  if (contested) {
    actor.winCount++;
    addFloat(x, y - 34, '拿下！', '#1565C0', FS('fL'), 1.2);
    actor.score += 50;
    addParticles(x, y, 14, ['#4D96FF', '#FFFFFF', '#FFD84D'], 1.0);
  }

  /* 里程碑 */
  if (actor.milestoneIdx < MILESTONES.length && actor.seatCount >= MILESTONES[actor.milestoneIdx].n) {
    var m = MILESTONES[actor.milestoneIdx];
    actor.milestoneIdx++;
    addBanner(m.emoji, st(m.text), st(m.sub), 'milestone');
    Sound.milestone();
    shake(4, 0.2);
  }

  /* 校园梗 */
  checkEggs(actor, c, r);
}

/* ---------- 占座反馈：NPC ---------- */
function claimFeedbackAi(actor, t, def, c, r) {
  actor.claimCount++;

  if (t.type === 'normal') {
    if (Math.random() < 0.16) {
      actor.bubbleText = st(pick(actor.lines));
      actor.bubble = 1;
    }
    return;
  }

  if (demo || !player || !player.alive) return;
  var d = Math.abs(c - player.c) + Math.abs(r - player.r);
  if (d > 5) return;

  /* P1-8（第九阶段）：文档 §三 把「NPC 抢座」明确列为**不该**用中央弹窗的例子 ——
     它每局要发生好几次，大横幅会一直抢视线。降级成「头顶飘字 + 音效」，
     只有黄金座（t.type === 'gold'）才升格为大提示：那种损失值得被打断一次。
     ⚠️ 这里只改渲染分支，addFloat / Sound.steal 的调用次数与顺序都没动。 */
  addFloat(CX(player.c), CY(player.r) - 30, '被抢了！', DANGER_STYLE.text, FS('fL'), 1.2);
  if (t.type === 'gold') {
    addBanner('😱', '被抢了！', st(def.label) + ' 被' + (actor.name || '同学') + '占走了', 'bad');
  }
  Sound.steal();
  if (t.type === 'gold') {
    addFloat(CX(player.c), CY(player.r) - 52, st('痛失摸鱼圣地。'), '#8A6A00', FS('fS'), 1.5);
  }
}

function checkEggs(actor, c, r) {
  var now = performance.now();
  if (now - eggTimer < 4000) return;
  var msg = null;
  if (r === ROWS - 1) msg = '安全感 +100';
  else if (r === 0) msg = '老师视野 +100%';
  else if (r <= 1 && c >= 8 && c <= 16) msg = '危险区域。';
  else if (actor.combo === 5) msg = '这几个都是我室友的。';
  else if (actor.combo === 12) msg = '你确定你只有一个人？';
  if (msg) {
    eggTimer = now;
    addFloat(CX(actor.c), CY(actor.r) - 46, st(msg), '#7A5B00', FS('fM'), 1.7);
  }
}

/* ==========================================================
 * 8b. 校园事件系统（V1.5 第二阶段）
 * ----------------------------------------------------------
 * 手册要求「让每局发生不同事情」。四个事件：
 *   1. 老师突然点名   —— 10 秒内跑到安全区，成功 +200，失败扣分
 *   2. 管理员清理占座 —— 随机清掉 20% 普通占座，保留特殊座位
 *   3. 室友求助       —— 连续占 4 个相邻座位，额外加分
 *   4. 老师巡视       —— 地图出现老师视野，进去降速；全程没被发现给「摸鱼大师」
 *
 * 这一节的硬规矩：所有随机走 evRand()，所有粒子都传 evRand —— 整节不许出现
 * Math.random()。否则「加事件」就会连带改变 NPC 走位，回归指纹再也对不上。
 * ========================================================== */

var EV_KINDS_V15 = ['roll', 'clean', 'roommate', 'patrol'];
/* V2 第六节新增的 4 个：
 *   early   老师提前进入教室 —— 前排两排变危险区，逼你往后躲
 *   swap    临时换教室       —— 全场占座清空，大家一起重抢
 *   canteen 食堂开饭         —— 同学们全跑光，NPC 集体减速（机会）
 *   exam    期末周狂暴模式   —— NPC 集体加速疯狂抢座（压力）
 * 刻意做成「两个压力 + 一个机会 + 一个大变数」，让每局节奏不一样。 */
var EV_KINDS_V2 = ['early', 'swap', 'canteen', 'exam'];

/* 第六阶段：图书馆专属事件。
 *   finalweek 期末周开始！—— 座位刷新速度增加（NPC 抢座明显加快，压力型）
 * 只在图书馆（SCENE.lib 非空）时才拼进池子 —— 教室三档指纹跑的永远是教室，
 * 池子大小不变 → evRand 消耗次数不变 → 老基线逐字命中。 */
var EV_KINDS_LIB = ['finalweek'];

/* 第七阶段：食堂专属事件。
 *   bell     开饭铃响 —— 所有学生（NPC + 玩家）步进 ×0.6，全场快进
 *   newdish  新菜上线 —— 随机刷出一块高价值区域
 * 同样只在食堂（SCENE.dine 非空）时才拼进池子 —— 池子大小决定 evRand 的消耗次数，
 * 教室 / 图书馆拿到的永远是原来那个 base 数组。 */
var EV_KINDS_CANTEEN = ['bell', 'newdish'];

/* 当前可用的事件池。V2_EVENTS_ON 关掉时整组摘掉 —— 池子大小决定 evRand 消耗次数，
 * 所以这是「保住 V1.5 事件档指纹」的必要条件。
 *
 * V1.6 第二阶段：EV_ONLY_CLEAN 打开时池子里只剩「管理员清理」一个。
 * 注意这里返回的是**新数组**（不是 EV_KINDS_V15 本身），所以老池子一个字节都没动 ——
 * `setV16(false)` 之后 evKinds() 立刻回到 V1.5 的取值，老基线继续有效。 */
function evKinds() {
  if (EV_ONLY_CLEAN) return ['clean'];
  var base = V2_EVENTS_ON ? EV_KINDS_V15.concat(EV_KINDS_V2) : EV_KINDS_V15;
  /* 三个场景各自专属的事件，都靠 concat 拼在新数组上 —— 拿到 base 的场景池子逐字不变。
     图书馆与食堂互斥（一个场景不可能同时有 lib 和 dine），所以顺序无所谓。 */
  if (libOn()) return base.concat(EV_KINDS_LIB);
  if (dineOn()) return base.concat(EV_KINDS_CANTEEN);
  return base;
}
var EV_INTERVAL_MIN = 9, EV_INTERVAL_MAX = 14;    /* 2026-09-19 调高频率：15-23s→9-14s。
                                                     * 单局 90 秒里约 5~7 个事件，比原来的 3~4 个明显密 */

/* 下一个事件的倒计时（秒） */
function evSchedule() { evTimer = EV_INTERVAL_MIN + evRand() * (EV_INTERVAL_MAX - EV_INTERVAL_MIN); }

/* ---------- 安全区选址 ----------
 * 只挑走道格。走道永远不会被占、永远不会挡路，
 * 所以「10 秒内到达」这件事永远可完成，不会出现无解局面。 */
function evPickAisleSpot() {
  var pool = [], far = [], c, r, i;
  for (r = 1; r < ROWS - 1; r++) {
    for (c = 1; c < COLS - 1; c++) {
      if (isAisle(c, r)) pool.push({ c: c, r: r });
    }
  }
  if (!pool.length) return { c: Math.floor(COLS / 2), r: Math.floor(ROWS / 2) };
  for (i = 0; i < pool.length; i++) {
    /* 太近就没有挑战了，优先挑离玩家 6 格以上的。
       双人模式下取「离最近那个玩家」的距离 —— 保证对双方都有跑动空间。
       单人时 humans 只有 1 个，结果与改造前逐字一致。 */
    var dmin = 99, h, d;
    for (h = 0; h < humans.length; h++) {
      d = Math.abs(pool[i].c - humans[h].c) + Math.abs(pool[i].r - humans[h].r);
      if (d < dmin) dmin = d;
    }
    if (dmin >= 6) far.push(pool[i]);
  }
  var use = far.length ? far : pool;
  return use[evInt(use.length)];
}

/* ---------- 事件 1：老师突然点名 ---------- */
function evStartRoll() {
  var spot = evPickAisleSpot();
  /* done 记录「谁已经有结论了」。单人模式下 humans 只有 1 个，
     行为与加这个字段之前完全一致。 */
  evActive = { kind: 'roll', t: 10, max: 10, c: spot.c, r: spot.r, done: {} };
  addBanner('📢', st('老师开始点名！'), st('10 秒内跑进绿圈'), 'bad', 2.0);
  Sound.skill();
  shake(5, 0.3);
}

function evTickRoll(dt) {
  var e = evActive, i, hu, saidGood = false, saidBad = false, allDone = true;
  /* 自愈：万一 evActive 是从「没有 done 字段」的旧状态恢复来的（存档 / 测试夹具），
     在这里补一个空表，而不是让整局崩掉。正常路径上 evStartRoll 已经给过了。 */
  e.done = e.done || {};
  e.t -= dt;

  /* 判定范围与画出来的 3×3 绿框完全一致，避免「看着在圈里其实不算」 */
  for (i = 0; i < humans.length; i++) {
    hu = humans[i];
    if (!hu.alive || e.done[hu.id]) continue;
    if (Math.abs(hu.c - e.c) <= 1 && Math.abs(hu.r - e.r) <= 1) {
      e.done[hu.id] = true;
      hu.score += 200;
      addFloat(CX(hu.c), CY(hu.r) - 54, '+200 安全！', '#1B7A3E', FS('fL'), 1.7);
      if (!saidGood) {          /* 横幅/音效全场只出一次，避免双人时刷屏 */
        saidGood = true;
        addParticles(CX(e.c), CY(e.r), 24, ['#4DD07A', '#FFFFFF', '#C6F6D5'], 1.2, evRand);
        addBanner('😮‍💨', st('躲过一劫！'), st('点名 +200'), 'milestone', 1.8);
        Sound.milestone();
      }
    }
  }
  for (i = 0; i < humans.length; i++) if (!e.done[humans[i].id]) allDone = false;

  /* 还有人没结论、且时间没到 → 继续等。单人下「玩家一进圈」就 allDone，
     所以这里不会 return，行为和改造前一致（立即结束）。 */
  if (!allDone && e.t > 0) return;

  if (e.t <= 0) {
    for (i = 0; i < humans.length; i++) {
      hu = humans[i];
      if (e.done[hu.id]) continue;
      e.done[hu.id] = true;
      hu.score = Math.max(0, hu.score - 80);
      addFloat(CX(hu.c), CY(hu.r) - 54, st('-80 被点名了'), DANGER_STYLE.text, FS('fL'), 1.7);
      if (!saidBad) {
        saidBad = true;
        addBanner('😱', st('被老师点名了'), '扣 80 分', 'bad', 1.8);
        Sound.steal();
      }
    }
  }
  evActive = null; evSchedule();
}

/* ---------- 事件 2：管理员清理占座物 ---------- */
function evHasCleanTarget() {
  for (var i = 0; i < grid.length; i++) {
    if (grid[i].owner && grid[i].type === 'normal') return true;
  }
  return false;
}

/* ---- V1.6 第二阶段：清理的「先定名单、后执行」两段式 ----
 * 文档要求「预告和实际清理必须是同一批格子」。做法不是把同一套随机跑两遍
 * （跑两遍必然不一样），而是**只在预告时跑一次随机、把格子清单存下来**，
 * 到点了按这份清单执行。
 *
 * 顺带把 V1.5 的 evStartClean 也拆成这两段 —— 两处共用同一份洗牌代码，
 * 随机流（evInt / evRand）的消耗次数与顺序**逐次不变**，
 * 所以 `--events` / `--v2` 两档老基线继续命中。 */
var EV_CLEAN_RATIO = 0.2;          /* 每次清掉多少比例的普通占座（可配置） */
var EV_CLEAN_AT = [30, 60];        /* V1.6 固定时间表：第 30 / 60 秒各清一次（局内已过秒数） */
var EV_CLEAN_WARN = 3;             /* 提前几秒把「待清理」标出来 */
var evCleanPlan = null;            /* { at: 执行秒数, cells: [格子下标…] } 已定名单、待执行 */
var evCleanMark = [];              /* 正在闪的待清理格子（下标），纯渲染用 */
var evCleanIdx = 0;                /* 固定时间表排到第几个时间点 */
var evCleanFired = 0;              /* 本局实际执行了几次固定清理（只给回归校验读） */

/* ===== V36 下一阶段 · 阶段 7：学霸的「提前预判」（弱提示） =====
 * 文档原文：「普通玩家提前 3 秒看到清理区；学霸可以更早获得弱提示，
 *   例如 6～8 秒前出现淡色虚线框。价值在于更早规划路线，而不是直接加更多分。」
 *
 * 三条硬约束：
 *   ① **不改清理名单、不改清理时机** —— 预判只是「现在按同一套规则算，会清哪一片」，
 *      正式名单仍然在 `at - EV_CLEAN_WARN` 那一刻才定（evCleanMarkPlan 一字未动）；
 *   ② **零随机消耗** —— evCleanRankWindows 是纯枚举，一次 evInt 都不掷；
 *   ③ **只在有学霸的局里出现** —— 关掉开关 = 完全没有这段（铁律 3）。
 * ⚠️ 已知局限：这是**同屏**游戏，双人共用一个画布，所以对手也看得见这个框。
 *    要真正做到「只有学霸看得见」，得给每个客户端单独渲染（现在没有这条管线）。 */
var SCHOLAR_PEEK_ON = true;
var SCHOLAR_PEEK_LEAD = 10;        /* 提前几秒开始预告（R3.4：7 → 10，用户要「更早」） */
var SCHOLAR_PEEK_REFRESH = 0.25;   /* 每 0.25 秒重算一次（占座在变，框和格子跟着挪） */
/* R3.4：逐格预览的名单缓存。`cells` = 现在按同一套规则算，会被清掉的那些座位。 */
var evCleanPeek = null;            /* { at, box:{c0,r0}, cells:[i…], t } */
var CLEAN_PEEK_SEAT_W = {};        /* 分值药丸宽度缓存（键 = TILE|+100），纯绘制用 */

/* 本局有没有学霸（只认人类玩家；NPC 没有角色） */
function scholarInPlay() {
  for (var i = 0; i < humans.length; i++) {
    if (humans[i].role && humans[i].role.id === 'scholar') return true;
  }
  return false;
}

/* 每帧一次，纯读 + 一个缓存对象。正式名单一出就丢掉预判（不画两层框）。
 *
 * ⚠️ R3.4（2026-10-22 用户：「学霸模式照着开发文档说的加一个能提前看到下一轮清理
 * 座位的功能，但是保留当前特殊座位高光亮起的功能」）。
 *    阶段 7 只算了一个**包围框**（c0/r0），玩家看得见「这一片」但看不见「哪几格」。
 *    这里改成**逐格名单**：复用 evCleanPickWindow 挑出的同一个窗口，
 *    把窗口里**当前真的会被清掉**的座位（被占 + 非走道 + 按 A 开关决定含不含特殊座）
 *    一个个列出来 —— 和正式名单同源，所以「预判圈出来的」就是「待会儿清掉的」。
 *
 * ⚠️ 玩家脚下的格子要摘掉吗？**不摘，但要标出来区别画**。
 *    正式执行时 evCleanPlan 会 prune 掉玩家脚下（手册 §七）。
 *    预判如果直接照搬 prune，玩家一走动名单就跳变；反过来不区分，
 *    玩家可能以为「我脚下这格也会被清」。折中：照列，渲染时画成**空心虚线**
 *    （= 你在这儿，这格到时候不会清）。
 *
 * ⚠️ 随机消耗：evCleanRankWindows 是纯枚举，一次 evInt 都不掷（铁律 1 不受影响）。 */
function evCleanPeekTick() {
  if (!SCHOLAR_PEEK_ON || !scholarInPlay() || evCleanPlan ||
      evCleanIdx >= EV_CLEAN_AT.length) {
    evCleanPeek = null;
    return;
  }
  var at = EV_CLEAN_AT[evCleanIdx];
  if (elapsed < at - SCHOLAR_PEEK_LEAD) { evCleanPeek = null; return; }
  /* 进了预判窗口。每帧重算太浪费（345 个窗口 × 25 格），按 0.25 秒刷新一次。 */
  if (evCleanPeek && evCleanPeek.at === at &&
      elapsed - evCleanPeek.t < SCHOLAR_PEEK_REFRESH) return;
  var win = evCleanPickWindow(evCleanRankWindows());
  if (!win) { evCleanPeek = null; return; }
  evCleanPeek = {
    at: at,
    box: { c0: win.c0, r0: win.r0 },
    /* win.occ 已经是「窗口内会被清的座位下标」，直接拿来用 ——
       不自己再扫一遍 grid，也就不会出现「预览和正式用的是两套判据」。 */
    cells: win.occ.slice(),
    t: elapsed
  };
}

function evCleanReset() {
  evCleanPlan = null; evCleanMark = []; evCleanIdx = 0; evCleanFired = 0;
  evCleanLastBox = null;
  evCleanPeek = null;
}
/* 只撤掉「正在预告」的可视状态，**不动计数器**。
 * 收场时用这个而不是 evCleanReset —— 否则第 90 秒结束时会把
 * 「本局跑了几次清理」也一并抹掉，回归基线就永远读到 0。 */
function evCleanClearMark() {
  evCleanPlan = null; evCleanMark = [];
  evCleanPeek = null;
}

/* 「玩家正踩着」的格子集合。手册 §七：不要清理当前玩家位置。
 * 双人模式两个玩家都算 —— 谁脚下都不该被清。 */
function evFeetSet() {
  var feet = {}, i, h;
  for (i = 0; i < humans.length; i++) {
    h = humans[i];
    if (h && h.alive) feet[I(h.c, h.r)] = 1;
  }
  return feet;
}

/* ---------- 阶段 2：集中区域清理 ----------
 * 窗口重叠面积（只用来判断「这一轮是不是又清了同一片」）。
 * 纯算术，零随机消耗。 */
function evCleanBoxOverlap(a, b) {
  var w = Math.min(a.c0 + EV_CLEAN_CLUSTER_W, b.c0 + EV_CLEAN_CLUSTER_W) - Math.max(a.c0, b.c0);
  var h = Math.min(a.r0 + EV_CLEAN_CLUSTER_H, b.r0 + EV_CLEAN_CLUSTER_H) - Math.max(a.r0, b.r0);
  return (w > 0 && h > 0) ? w * h : 0;
}

/* 集中区域清理的名单生成。
 *
 * 枚举所有 W×H 窗口 → 数每个窗口里「已占座位」（普通 + 特殊，按 EV_CLEAN_SPECIAL_ON）
 * → 排序 → 取第一名。排序键：
 *   ① 有 1C 需求时，窗口内「玩家还没抢到过的插座位」多的优先（让区域自己带上任务目标）；
 *   ② 已占座位数多的优先；
 *   ③ r0 / c0 小的优先 —— 纯粹为了**确定性**（同种子同局面必然选出同一个窗口）。
 *
 * ⚠️ 这里**一次 evInt 都不掷**。平局完全由 ③ 打破，所以整条路径对随机流零消耗，
 *    同种子下「开关打开」的每一轮清理都是可复现的。
 * ⚠️ 关掉 EV_CLEAN_CLUSTER_ON 时这个函数根本不会被调用（走老路径）。 */

/* 阶段 7：把「枚举 + 排序」从 evBuildCleanClusterCells 里抽出来。
 * 为什么抽：学霸的「提前预判框」（弱提示）要在**正式名单还没定**的时候就知道
 * 「大概会清哪一片」。如果它自己再写一套排序，预判框和实际名单迟早对不上；
 * 复用同一个排序函数，预判框和正式框就永远是同一个算法算出来的。
 * ⚠️ 纯函数：不写 evCleanLastBox、不改 grid、不掷随机数。 */
function evCleanRankWindows() {
  var W = EV_CLEAN_CLUSTER_W, H = EV_CLEAN_CLUSTER_H;
  var needPlug = TASK_PLUG_REMEDY_ON && taskPlugRemedyWanted();
  var cand = [], c0, r0, c, r, t, idx;

  for (r0 = 0; r0 + H <= ROWS; r0++) {
    for (c0 = 0; c0 + W <= COLS; c0++) {
      var occ = [], plugN = 0;
      for (r = r0; r < r0 + H; r++) {
        for (c = c0; c < c0 + W; c++) {
          idx = I(c, r);
          t = grid[idx];
          if (t.aisle || !t.owner) continue;                     /* 走道 / 空座不算 */
          if (t.type !== 'normal' && !EV_CLEAN_SPECIAL_ON) continue;  /* 与老路径同一条规则 */
          occ.push(idx);
          if (needPlug && t.type === 'plug' && !plugClaimedSet[idx]) plugN++;
        }
      }
      if (occ.length) cand.push({ c0: c0, r0: r0, occ: occ, plug: plugN });
    }
  }
  if (!cand.length) return [];

  cand.sort(function (a, b) {
    if (b.plug !== a.plug) return b.plug - a.plug;
    if (b.occ.length !== a.occ.length) return b.occ.length - a.occ.length;
    if (a.r0 !== b.r0) return a.r0 - b.r0;
    return a.c0 - b.c0;
  });
  return cand;
}

/* 从排好序的候选里挑一个。纯读：只读 evCleanLastBox，不写。
 *
 * 避免连着清同一片：首选若与上一轮重叠超过半个窗口，就退到「第一个几乎不重叠」的候选。
 * 退让有下限 —— 替补的占座数必须 ≥ 首选的 60%，而且插座位数不能变少（1C 优先）。
 * 达不到就不换：宁可再清一次最挤的那片，也不要清一片没什么人的区域。 */
function evCleanPickWindow(cand) {
  if (!cand || !cand.length) return null;
  var pick = 0;
  if (evCleanLastBox) {
    var half = EV_CLEAN_CLUSTER_W * EV_CLEAN_CLUSTER_H / 2, i2;
    for (i2 = 0; i2 < cand.length; i2++) {
      if (evCleanBoxOverlap(cand[i2], evCleanLastBox) <= half) break;
    }
    if (i2 < cand.length && i2 !== 0) {
      var alt = cand[i2], top = cand[0];
      if (alt.plug >= top.plug && alt.occ.length * 5 >= top.occ.length * 3) pick = i2;
    }
  }
  return cand[pick];
}

/* 阶段 7：学霸的预判窗口（只读，不产生任何状态）。
 * 返回 { c0, r0 } 或 null。调用方自己决定要不要画。
 *
 * R3.4：正式渲染已经改用 `evCleanPeek.cells`（逐格），这个函数**保留**是因为
 * 它是「只算一次、不落地」的纯净版 —— 探针拿它做「预测 vs 正式名单」的对照，
 * 不依赖 0.25 秒的缓存时机。删掉它会让探针拿到一个带缓存的状态，反而更难断言。 */
function evCleanPeekBox() {
  var win = evCleanPickWindow(evCleanRankWindows());
  return win ? { c0: win.c0, r0: win.r0 } : null;
}

function evBuildCleanClusterCells() {
  var W = EV_CLEAN_CLUSTER_W, H = EV_CLEAN_CLUSTER_H;
  var needPlug = TASK_PLUG_REMEDY_ON && taskPlugRemedyWanted();
  var i;
  var cand = evCleanRankWindows();
  if (!cand.length) return null;

  var win = evCleanPickWindow(cand);
  evCleanLastBox = { c0: win.c0, r0: win.r0 };
  var out = win.occ.slice();

  /* 玩家脚下的格子摘掉（手册 §七：管理员不会清掉玩家脚下）。
     ⚠️ 与老路径不同，这里**不做补足** —— 窗口是固定的，摘掉就是少一格，
        从窗口外补会破坏「集中」这个前提。 */
  var feet = null;
  if (EV_CLEAN_SKIP_FEET) {
    feet = evFeetSet();
    var keep = [];
    for (i = 0; i < out.length; i++) if (!feet[out[i]]) keep.push(out[i]);
    out = keep;
  }

  /* 1C 的保底补救：窗口里自带的未抢插座位不够 MIN 个时，从窗口外按
     「离窗口中心最近」补 —— 保持「区域 + 最近的一两格」的观感，
     而不是从全图随便抓。纯数组读 + 距离排序，零随机消耗。 */
  if (needPlug) {
    var got = 0, k;
    for (k = 0; k < out.length; k++) {
      if (grid[out[k]].type === 'plug' && !plugClaimedSet[out[k]]) got++;
    }
    if (got < TASK_PLUG_REMEDY_MIN) {
      var cc = win.c0 + (W - 1) / 2, cr = win.r0 + (H - 1) / 2;
      var extra = [];
      for (i = 0; i < grid.length; i++) {
        if (grid[i].type !== 'plug' || !grid[i].owner) continue;
        if (plugClaimedSet[i]) continue;
        if (out.indexOf(i) >= 0) continue;
        if (EV_CLEAN_SKIP_FEET && feet && feet[i]) continue;
        var ec = i % COLS, er = (i / COLS) | 0;
        extra.push({ i: i, d: Math.abs(ec - cc) + Math.abs(er - cr) });
      }
      extra.sort(function (a, b) { return a.d - b.d || a.i - b.i; });
      for (i = 0; i < extra.length && got < TASK_PLUG_REMEDY_MIN; i++) {
        out.push(extra[i].i);
        got++;
      }
    }
  }

  return out.length ? out : null;
}

/* 挑出这一轮要清的格子。没有可清的占座 → 返回 null。
 * ⚠️ 这是唯一消耗随机数的地方，洗牌顺序与原 evStartClean 逐字一致。
 *
 * A（2026-10-04）：返回的名单里**还可能包含已被占领的特殊座位**。
 *   文档：「定时清理时，也选取部分已被占领的特殊座位，提前标出来，清理后恢复为空座，
 *   让大家重新抢」—— 否则前期抢到好位置的人一占永逸，后半局没有值得再争的目标。
 *   调用方原样把它交给 `evApplyClean(cells)` 即可 —— 那边默认按 EV_CLEAN_SPECIAL_ON
 *   决定要不要动特殊座位，与这里产出的名单天然一致（返回值仍是**数组**，接口没变）。 */
function evBuildCleanCells() {
  /* 阶段 2：集中区域清理。关掉时**整段跳过** → 下面的老路径逐字不变（铁律 1 / 3）。 */
  if (EV_CLEAN_CLUSTER_ON) return evBuildCleanClusterCells();

  var pool = [], i;
  for (i = 0; i < grid.length; i++) {
    /* 普通座位池 —— 老路径，一字未改 */
    if (grid[i].owner && grid[i].type === 'normal') pool.push(i);
  }

  /* 已被占领的**特殊座位**单独一池。
     ⚠️ 开关关掉时**连这个池子都不建** → 一次 evInt 都不多掷，随机流与改造前逐字相同。 */
  var spPool = null;
  if (EV_CLEAN_SPECIAL_ON) {
    spPool = [];
    for (i = 0; i < grid.length; i++) {
      if (grid[i].owner && grid[i].type !== 'normal') spPool.push(i);
    }
  }

  if (!pool.length && !(spPool && spPool.length)) return null;

  for (i = pool.length - 1; i > 0; i--) {           /* 洗牌走事件自己的随机流 */
    var j = evInt(i + 1), tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  var n = Math.round(pool.length * EV_CLEAN_RATIO);
  if (n < 1) n = 1;
  if (n > pool.length) n = pool.length;
  var out = pool.slice(0, n);

  /* 特殊座位：同一套「洗牌 + 取比例」，紧接在普通座位之后，用的是**同一路 evInt**。
     ⚠️ 所以只有 A 打开时才会多掷随机数 —— 关掉时随机流与改造前逐字相同（铁律 1）。 */
  var spOut = [];
  if (spPool && spPool.length) {
    for (i = spPool.length - 1; i > 0; i--) {
      var j2 = evInt(i + 1), tmp2 = spPool[i]; spPool[i] = spPool[j2]; spPool[j2] = tmp2;
    }
    var ns = Math.round(spPool.length * EV_CLEAN_SPECIAL_RATIO);
    if (ns < 1) ns = 1;
    if (ns > spPool.length) ns = spPool.length;
    spOut = spPool.slice(0, ns);
  }

  /* V1.6：把玩家脚下的格子从名单里摘掉（手册 §七 / §十七「管理员不会清掉玩家脚下」）。
   *
   * ⚠️ 必须在**洗牌 + slice 之后**才过滤。如果在洗牌前过滤，pool.length 就变了，
   *    evInt(i + 1) 的参数跟着变 → 随机消耗次数变 → 整局重排（铁律一）。
   *    过滤之后「少掉几格」用洗好的序列**继续往后取**补回来 ——
   *    只是多读几个已经洗好的下标，一次随机数都不多掷，清理数量因此保持不变。 */
  if (EV_CLEAN_SKIP_FEET) {
    var feet = evFeetSet(), keep = [];
    for (i = 0; i < out.length; i++) if (!feet[out[i]]) keep.push(out[i]);
    for (i = n; i < pool.length && keep.length < n; i++) {
      if (!feet[pool[i]]) keep.push(pool[i]);
    }
    out = keep;
    /* 特殊座位同样摘掉脚下的。不做补足 —— 文档只要求「选取部分」，没要求精确数量，
       补足反而会让「清几个特殊座位」随玩家站位漂移。 */
    var keepSp = [];
    for (i = 0; i < spOut.length; i++) if (!feet[spOut[i]]) keepSp.push(spOut[i]);
    spOut = keepSp;
  }
  out = out.concat(spOut);

  /* 1C（2026-10-15）：插座任务的**保底补救机会**。
   *   场景：任务要 3 个「本局累计抢到的不同插座」，但插座位被 NPC 占满后玩家抢不回来
   *   （规则不允许抢别人的座）→ 任务永久无解。而固定清理是全图随机，不保证放到插座位。
   *   做法：若「充电自由」还在进行且玩家还没抢够，就从**已经洗好的** `spPool` 里按顺序
   *   补进最多 `TASK_PLUG_REMEDY_MIN` 个「玩家没抢到过」的插座位。
   *   ⚠️ 只是往后读几个**已洗好的**下标 —— 一次随机数都不多掷（铁律 1）。
   *   ⚠️ 开关关掉时这段整段不进 → 名单与 v36 逐字相同。 */
  if (TASK_PLUG_REMEDY_ON && spPool && spPool.length && taskPlugRemedyWanted()) {
    var needRem = TASK_PLUG_REMEDY_MIN, i4;
    for (i4 = 0; i4 < spPool.length && needRem > 0; i4++) {
      var pi = spPool[i4];
      if (grid[pi].type !== 'plug') continue;          /* 只要插座位 */
      if (plugClaimedSet[pi]) continue;                /* 玩家已抢到过 → 不算补救 */
      if (out.indexOf(pi) >= 0) continue;              /* 本来就要清 → 别重复 */
      if (EV_CLEAN_SKIP_FEET && feet && feet[pi]) continue;   /* 别清玩家脚下 */
      out.push(pi);
      needRem--;
    }
  }

  return out.length ? out : null;
}

/* 预告期内有人走到圈里 → 把那一格从名单和标记里一起摘掉。
 *
 * 为什么需要：预告有 EV_CLEAN_WARN 秒的窗口，玩家完全可能在这 3 秒里走上
 * 自己被圈住的座位（那是他的「安全通路」，走上去最自然不过）。
 * 这时候「不动名单」会让玩家脚下被清，「执行时才跳过」又会让预告失准。
 * 所以做法是**当场把圈撤掉** —— 玩家看到的圈消失了，预告与实际依旧逐格一致。
 * 纯读坐标 + 过滤数组，零随机消耗。 */
function evCleanPruneFeet() {
  if (!evCleanPlan) return;
  var feet = evFeetSet(), keep = [], i;
  for (i = 0; i < evCleanPlan.cells.length; i++) {
    if (!feet[evCleanPlan.cells[i]]) keep.push(evCleanPlan.cells[i]);
  }
  if (keep.length !== evCleanPlan.cells.length) {
    evCleanPlan.cells = keep;
    evCleanMark = keep;
  }
}

/* 按给定的格子清单执行清理，返回实际清掉的格数。
 *
 * ⚠️ **只回收座位，绝不回扣分数**（V1.6 明确要求）。
 *    分数在占座那一刻就已经结算进 actor.score 了；清座位是「地没了」，
 *    不是「分没了」—— 这里只动 seatCount，一个字都不碰 score。
 *
 * 清单里的格子到执行时可能已经不属于原主（3 秒预告期内被别的机制清掉、
 * 或原主被复位），所以逐个复查 owner / type 再动手。V1.5 那条路径是
 * 「定名单后同帧执行」，复查永远通过 —— 与改造前逐字一致。 */
function evApplyClean(cells, allowSpecial) {
  /* A（2026-10-04）：默认按开关决定要不要动特殊座位 —— 这样 `evBuildCleanCells()`
     产出的名单可以原样丢进来，所有调用点（含测试台）一个都不用改。 */
  if (allowSpecial === undefined) allowSpecial = EV_CLEAN_SPECIAL_ON;
  var mine = {}, i, n = 0;
  for (i = 0; i < cells.length; i++) {
    var idx = cells[i], cell = grid[idx];
    if (!cell.owner) continue;
    /* 预告时是普通座位，执行时也必须是 —— 除非这一轮本来就允许清特殊座位。
       （grid 的 type 在建图时就定了、永不改变，所以这条本身只是防御性复查。） */
    if (cell.type !== 'normal' && !allowSpecial) continue;
    var c = idx % COLS, r = (idx / COLS) | 0;
    mine[cell.owner] = (mine[cell.owner] || 0) + 1;
    var ow = actorById(cell.owner);
    if (ow && ow.seatCount > 0) ow.seatCount--;
    cell.owner = null; cell.item = ''; cell.anim = 0; cell.claimAge = 0; cell.hm = 0; cell.hmh = 0;
    evFx.push({ x: CX(c), y: CY(r), t: 0.75, max: 0.75 });
    if (i < 18) addParticles(CX(c), CY(r), 4, ['#CFE3F5', '#FFFFFF', '#9DB8CC'], 0.6, evRand);
    n++;
  }

  /* 清理完，被堵住的同学又能动了 —— 手册说的「重新打开地图空间」 */
  for (i = 0; i < npcs.length; i++) {
    if (npcs[i].blocked && hasFreeNeighbor(npcs[i].c, npcs[i].r)) npcs[i].blocked = false;
  }

  addBanner('🧹', st('管理员来了！'), '清理了 ' + n + ' 个占座', 'bad', 1.8, true);
  /* 谁被清了就在谁头顶飘一条 —— 单人时 humans 只有 1 个，与改造前逐字一致 */
  for (i = 0; i < humans.length; i++) {
    var lost = mine[humans[i].id] || 0;
    if (lost > 0) addFloat(CX(humans[i].c), CY(humans[i].r) - 54, '你的 ' + lost + ' 个座位被清了', '#1565C0', FS('fM'), 1.9);
  }
  Sound.ui();
  shake(4, 0.26);
  return n;
}

/* V1.5 的随机触发版本（EV_SCHED_ON 打开时才会被 evStart 调到）。
 * 与改造前逐字等价：定名单 → 同帧执行 → 排下一个事件。 */
function evStartClean() {
  var cells = evBuildCleanCells();
  if (!cells) { evSchedule(); return; }
  evApplyClean(cells);
  evActive = null; evSchedule();
}

/* V1.6 固定时间表的预告阶段：把这一轮的名单定下来、标出来，等 at 秒到点执行。
 * 返回 false = 场上没有可清的普通占座 → 这个时间点整个跳过。 */
function evCleanMarkPlan(at) {
  var cells = evBuildCleanCells();
  if (!cells) return false;
  evCleanPlan = { at: at, cells: cells };
  /* 阶段 2：把这一轮清的那片窗口一起记下来 —— 渲染时用它画一个大虚线框，
     让玩家一眼看出「是这一片」，而不是一堆零散的橙格子。
     1C 从窗口外补的那一两格**不算在框里**（框只表示主区域）。 */
  if (EV_CLEAN_CLUSTER_ON && evCleanLastBox) {
    evCleanPlan.box = { c0: evCleanLastBox.c0, r0: evCleanLastBox.r0 };
  }
  evCleanMark = cells;
  /* ⚠️ 文案对齐 V1.6 手册 §七 原文：「顶部提示『管理员来了！这些座位马上要被清理！』」。
     改前是「管理员马上就到 ｜ 被圈住的座位要被清掉」—— 意思一样，但**不是手册写的那句**。
     ⚠️ 主 / 副文案都必须过 `st()`：食堂里「管理员」要说成「收桌的」、「座位」要说成「桌子」
     （SCENE_TEXT.canteen 第 832~833 行两条映射都在）。 */
  addBanner('🧹', st('管理员来了！'), st('这些座位马上要被清理！'), 'bad', 1.6, true);
  Sound.ui();
  return true;
}

/* V1.6 固定时间表：暂停随机排程之后，整局只有两次管理员清理。
 * 第 27 / 57 秒标名单（EV_CLEAN_AT 减 EV_CLEAN_WARN），第 30 / 60 秒执行。
 * 秒数用**局内已过时间** elapsed，不是倒计时 —— 和文档「第 30 秒」的说法对齐。 */
function evCleanSchedTick() {
  if (EV_SCHED_ON) return;          /* 老排程开着时，这条固定时间表整个不跑 */
  /* 阶段 7：学霸预判。**只更新一个缓存对象**，不碰名单/时机/计数器 ——
     放在最前面，是为了让它在「正式名单已存在」时也能及时清掉（函数里自己判断）。 */
  evCleanPeekTick();
  if (evCleanPlan) {
    /* 预告期内有人走进圈里 → 当场把那一格的圈撤掉（名单与标记一起改），
       这样「玩家脚下不被清」和「预告 = 实际」两条要求同时成立。 */
    evCleanPruneFeet();
    if (!evCleanPlan.cells.length) {           /* 全被摘光了 → 这次没什么可清 */
      evCleanPlan = null; evCleanMark = []; evCleanIdx++;
      return;
    }
    if (elapsed < evCleanPlan.at) return;      /* 还在预告期 */
    var cells = evCleanPlan.cells;
    /* 阶段 10 前置：**先把框存下来** —— 下一行 `evCleanPlan = null` 一执行，
       这里就再也读不到 box 了。争抢统计的口径是「清理执行的那一刻两人站哪儿」，
       必须在 applyClean 之前取，位置这一帧内不会变，但对象会被丢掉。 */
    var cleanBox = evCleanPlan.box;
    evCleanPlan = null; evCleanMark = []; evCleanIdx++; evCleanFired++;
    recCleanContest(cleanBox);
    evApplyClean(cells);            /* ← 用的正是预告时定下的那份名单 */
    return;
  }
  if (evCleanIdx >= EV_CLEAN_AT.length) return;
  var at = EV_CLEAN_AT[evCleanIdx];
  if (elapsed < at - EV_CLEAN_WARN) return;
  /* 走到这里说明已经进了预告窗口。若一帧跨过了整个窗口（测试里手动推进时间、
     或极端卡顿），elapsed 可能已 >= at —— 那就标完当帧执行，名单仍是同一份，
     只是没有预告时间可看。 */
  if (!evCleanMarkPlan(at)) evCleanIdx++;   /* 没东西可清 → 跳过这个时间点 */
}

/* ---------- 事件 3：室友求助（连续占 4 个相邻座位） ---------- */
function evStartRoommate() {
  var who = null, i, n;
  /* 优先挑教室中段的同学：他的头顶气泡才画得下，
   * 坐在第 0/1 排的话气泡会顶到墙上，看着像贴错地方。 */
  for (i = 0; i < npcs.length; i++) {
    n = npcs[i];
    if (!n.blocked && n.r >= 2 && n.r <= ROWS - 3) { who = n; break; }
  }
  if (!who) for (i = 0; i < npcs.length; i++) { if (!npcs[i].blocked) { who = npcs[i]; break; } }
  if (!who && npcs.length) who = npcs[0];
  evActive = { kind: 'roommate', t: 20, max: 20, need: 4, prog: 0, who: who, done: {} };
  addBanner('🙋', (who ? who.name : '室友') + ' 求助', '连续占 4 个相邻座位', 'good', 2.0);
  Sound.ui();
}

/* 某个玩家目前最长的一条连座（横着或竖着）。走道会打断连线，因为走道占不了。
 * who 省略时按 1P 算 —— 保持老调用点（任务系统）的行为不变。 */
function evLongestRun(who) {
  var id = who ? who.id : player.id;
  var best = 0, c, r, n, t;
  for (r = 0; r < ROWS; r++) {
    n = 0;
    for (c = 0; c < COLS; c++) {
      t = grid[I(c, r)];
      if (!t.aisle && t.owner === id) { n++; if (n > best) best = n; }
      else n = 0;
    }
  }
  for (c = 0; c < COLS; c++) {
    n = 0;
    for (r = 0; r < ROWS; r++) {
      t = grid[I(c, r)];
      if (!t.aisle && t.owner === id) { n++; if (n > best) best = n; }
      else n = 0;
    }
  }
  return best;
}

function evTickRoommate(dt) {
  var e = evActive, i, hu, allDone = true;
  e.done = e.done || {};            /* 自愈，理由同 evTickRoll */
  e.t -= dt;

  for (i = 0; i < humans.length; i++) {
    hu = humans[i];
    if (!hu.alive || e.done[hu.id]) continue;
    var run = evLongestRun(hu);
    /* 进度飘字只跟 1P 走 —— 双人时两条进度互相打架，反而看不清 */
    if (i === 0 && run > e.prog) {
      e.prog = run;
      if (run < e.need) addFloat(CX(hu.c), CY(hu.r) - 54, '连座 ' + run + '/' + e.need, '#7B4B00', FS('fS'), 1.1);
    }
    if (run >= e.need) {
      e.done[hu.id] = true;
      hu.score += 150;
      addFloat(CX(hu.c), CY(hu.r) - 54, '+150 连座搞定！', '#1B7A3E', FS('fL'), 1.9);
      if (i === 0) {
        addParticles(CX(hu.c), CY(hu.r), 20, ['#FFD84D', '#FFFFFF', '#FFE9A8'], 1.1, evRand);
        addBanner('🛏️', '连座搞定！', '室友请你喝奶茶 +150', 'milestone', 1.8);
        Sound.milestone();
      }
    }
  }
  for (i = 0; i < humans.length; i++) if (!e.done[humans[i].id]) allDone = false;
  if (!allDone && e.t > 0) return;

  if (e.t <= 0) {
    for (i = 0; i < humans.length; i++) {
      if (e.done[humans[i].id]) continue;
      e.done[humans[i].id] = true;
    }
    addBanner('😔', '室友没等到连座', '下次早点占', 'bad', 1.6);
  }
  evActive = null; evSchedule();
}

/* ---------- 事件 4：老师巡视 ---------- */
function evStartPatrol() {
  var rows = [], r;
  for (r = 1; r < ROWS - 1; r++) { if (isAisle(0, r)) rows.push(r); }
  if (!rows.length) rows.push(Math.floor(ROWS / 2));
  var lane = rows[evInt(rows.length)];
  var fromLeft = evRand() < 0.5;
  evActive = {
    kind: 'patrol', t: 12, max: 12,
    c: fromLeft ? -0.6 : COLS - 0.4, r: lane,
    dc: fromLeft ? 1 : -1, speed: 2.6, rad: 3.4,
    entered: {}                    /* 谁被看见过 —— 按玩家分开记 */
  };
  addBanner('👀', st('老师巡视中！'), '别进红圈，全程躲开有奖励', 'bad', 2.0);
  Sound.skill();
}

function evTickPatrol(dt) {
  var e = evActive, i, hu, said = false;
  /* entered 从「一个布尔」改成了「按玩家分开的集合」。
     老夹具（或旧存档）给的是布尔，这里统一转成空表 —— true 也当空表，
     反正这一帧会把真正被看见的人重新记一遍。 */
  if (!e.entered || e.entered === true || e.entered === false) e.entered = {};
  e.t -= dt;
  e.c += e.dc * e.speed * dt;
  if (e.c < -1.2) { e.c = -1.2; e.dc = 1; }
  if (e.c > COLS + 0.2) { e.c = COLS + 0.2; e.dc = -1; }

  /* 视野是个横向的椭圆：曼哈顿距离给行方向加一点权重。
     双人模式下两个人各自判定自己有没有被看见。 */
  for (i = 0; i < humans.length; i++) {
    hu = humans[i];
    if (!hu.alive) continue;
    var d = Math.abs(hu.c - e.c) + Math.abs(hu.r - e.r) * 1.15;
    if (d <= e.rad) {
      e.entered[hu.id] = true;
      /* 复用「点名危机」的减速通道，actorStepMs 已经在乘 1.6 了 */
      if (hu.slow < 0.5) hu.slow = 0.5;
    }
  }

  if (e.t <= 0) {
    for (i = 0; i < humans.length; i++) {
      hu = humans[i];
      if (e.entered[hu.id]) continue;      /* 被看见过，拿不到奖励 */
      hu.score += 120;
      addFloat(CX(hu.c), CY(hu.r) - 54, '+120 摸鱼大师！', '#7B4B00', FS('fL'), 1.9);
      if (!said) {
        said = true;
        addBanner('🎣', st('摸鱼大师！'), st('老师巡视全程没被发现 +120'), 'milestone', 2.0);
        Sound.milestone();
      }
    }
    if (!said) addBanner('👀', st('被老师看见了'), '下次躲远点', 'bad', 1.6);
    evActive = null; evSchedule();
  }
}

/* ==========================================================
 * V2 第六节：4 个新的校园事件
 * ----------------------------------------------------------
 * 和上面 4 个同一套硬规矩：随机只走 evRand()，粒子必须传 evRand，
 * 整节不许出现 Math.random()。
 *
 * 另外多一条自律：**不改变 NPC 的行动次数**。
 * 「食堂开饭」和「期末周狂暴」分别复用 slow 通道、新增 rage 通道，
 * 两者都只乘在步进**间隔**上 —— 和第五节的 pace 一样，改的是间隔、
 * 不是 Math.random() 的调用次数。否则随机序列会被事件本身推偏，
 * 玩法状态就不再只由种子决定了。
 *
 * 四个事件的定位刻意错开，让每局节奏不一样：
 *   early 压力 / exam 压力 / canteen 机会 / swap 大变数
 * ========================================================== */

/* ---------- 事件 5：老师提前进入教室 ----------
 * 老师往讲台上一站，**前排两排**变成危险区：站进去就减速 + 持续掉分。
 * 和「老师巡视」的区别：巡视是横向扫过的移动视野，这个是**不动的静态威胁区**，
 * 压力来自「你前排占的那几个座现在成了烫手山芋」—— 逼你把布局往后挪。 */
var EV_EARLY_ROWS = 2;      /* 前排几排算危险区 */
var EV_EARLY_TICK = 0.6;    /* 每多少秒扣一次分 */
var EV_EARLY_COST = 6;      /* 每次扣几分 */

function evStartEarly() {
  /* pen / hurt 都按玩家分开记账 —— 双人时一个人在危险区里挨扣，
     另一个人在后面安全，两个人的结论必须互不影响。 */
  evActive = { kind: 'early', t: 12, max: 12, rows: EV_EARLY_ROWS, pen: {}, hurt: {} };
  addBanner('👨‍🏫', st('老师提前进教室了！'), st('前排两排别待着，快往后躲'), 'bad', 2.0);
  Sound.skill();
  shake(5, 0.3);
}

function evTickEarly(dt) {
  var e = evActive, i, hu, said = false;
  e.pen = e.pen || {}; e.hurt = e.hurt || {};   /* 自愈，理由同 evTickRoll */
  e.t -= dt;

  for (i = 0; i < humans.length; i++) {
    hu = humans[i];
    if (!hu.alive) continue;
    if (hu.r < e.rows) {
      e.hurt[hu.id] = true;
      if (hu.slow < 0.5) hu.slow = 0.5;        /* 被老师盯上，走得也慢 */
      e.pen[hu.id] = (e.pen[hu.id] || 0) + dt;
      if (e.pen[hu.id] >= EV_EARLY_TICK) {
        e.pen[hu.id] -= EV_EARLY_TICK;
        if (hu.role && hu.role.id === 'slacker') {
          /* 摸鱼大师：对老师的盯梢免疫 —— 不扣分，给个绿色提示让玩家知道生效了。
           * 这条 addFloat 不带 Math.random，跳过/替换都不影响随机序列。 */
          addFloat(CX(hu.c), CY(hu.r) - 46, '摸鱼：无视！', '#1B7A3E', FS('fS'), 0.9);
        } else {
          hu.score = Math.max(0, hu.score - EV_EARLY_COST);
          addFloat(CX(hu.c), CY(hu.r) - 46, '-' + EV_EARLY_COST + ' 被老师盯着', DANGER_STYLE.text, FS('fS'), 0.9);
        }
      }
    } else {
      e.pen[hu.id] = 0;                        /* 退回后排就不扣了 */
    }
  }

  if (e.t <= 0) {
    for (i = 0; i < humans.length; i++) {
      hu = humans[i];
      if (e.hurt[hu.id]) continue;
      hu.score += 150;
      addFloat(CX(hu.c), CY(hu.r) - 54, '+150 全程没被盯上', '#1B7A3E', FS('fL'), 1.9);
      if (!said) {
        said = true;
        addParticles(CX(hu.c), CY(hu.r), 20, ['#4DD07A', '#FFFFFF', '#C6F6D5'], 1.1, evRand);
        addBanner('😌', '安全躲过！', '全程没进前排 +150', 'milestone', 1.8);
        Sound.milestone();
      }
    }
    if (!said) addBanner('😬', st('被老师盯了一路'), '下次往后面坐', 'bad', 1.6);
    evActive = null; evSchedule();
  }
}

/* ---------- 事件 6：临时换教室 ----------
 * 教务通知「这节换教室」，全场占座清空，大家一起从头抢。
 * 领先的人心疼、落后的人翻盘 —— 四个事件里唯一的「大变数」。
 *
 * 只清**归属**，不动座位类型：黄金/插座/王座/情侣这些地图骨架保持原样，
 * 所以这个事件不会让地图看起来「换了张图」。 */
function evStartSwap() {
  var i, n = 0, c, r;
  for (i = 0; i < grid.length; i++) {
    if (!grid[i].owner) continue;
    c = i % COLS; r = (i / COLS) | 0;
    grid[i].owner = null; grid[i].item = ''; grid[i].anim = 0; grid[i].claimAge = 0;
    grid[i].hm = 0; grid[i].hmh = 0;
    grid[i].contest = false; grid[i].vsMark = 0;
    n++;
    /* 涟漪按「每 4 个被清的座位撒一个」均匀铺满全场。
       只取前 40 个的话会全部堆在顶部几排，看着像只清了上半间教室。 */
    if (n % 4 === 0) evFx.push({ x: CX(c), y: CY(r), t: 0.75, max: 0.75, col: '#8E7CC3' });
  }
  /* 所有人的占座计数一起归零 —— 不清的话结算会报出「占了 30 个」但场上一个都没有。
     顺手解掉被自己占座围死的同学，否则清空之后他们还站在那儿一动不动。 */
  for (i = 0; i < actors.length; i++) {
    actors[i].seatCount = 0;
    actors[i].coupleDone = false;      /* 情侣座奖励跟着重算，不然新占的这对发不了奖 */
    if (actors[i].blocked && hasFreeNeighbor(actors[i].c, actors[i].r)) actors[i].blocked = false;
  }
  addBanner('🚪', st('临时换教室！'), '座位全部清空，重新抢（清了 ' + n + ' 个）', 'bad', 2.2);
  /* 每个玩家头顶各飘一条 —— 双人时两个人的座位都被清了，只提 1P 会让 2P 以为没事 */
  for (i = 0; i < humans.length; i++) {
    if (!humans[i].alive) continue;
    addFloat(CX(humans[i].c), CY(humans[i].r) - 54, '重新开始抢！', '#1565C0', FS('fL'), 2.0);
  }
  Sound.steal();
  shake(7, 0.4);
  evActive = null; evSchedule();
}

/* ---------- 事件 7：食堂开饭 ----------
 * 「食堂开饭了」—— 同学们全跑光，NPC 集体减速，玩家可以趁机狂抢。
 * 减速走的是既有的 slow 通道（actorStepMs 里已经乘了 1.8）。 */
function evStartCanteen() {
  evActive = { kind: 'canteen', t: 8, max: 8 };
  for (var i = 0; i < npcs.length; i++) npcs[i].slow = Math.max(npcs[i].slow || 0, 8);
  addBanner('🍜', st('食堂开饭了！'), st('同学们都跑了，趁现在狂抢'), 'good', 2.0);
  Sound.ui();
}

function evTickCanteen(dt) {
  var e = evActive, i;
  e.t -= dt;
  /* 每帧把 slow 钉在「事件剩余时间」上，避免中途先失效（slow 是每帧自减的） */
  for (i = 0; i < npcs.length; i++) {
    if ((npcs[i].slow || 0) < e.t) npcs[i].slow = e.t;
  }
  if (e.t <= 0) { evActive = null; evSchedule(); }
}

/* ---------- 事件 8：期末周狂暴模式 ----------
 * 期末周图书馆没位置，所有人都疯了 —— NPC 集体加速抢座。
 * 用新增的 rage 通道，和 pace 一样只乘**间隔**，不改变随机数消耗次数。 */
function evStartExam() {
  evActive = { kind: 'exam', t: 10, max: 10 };
  for (var i = 0; i < npcs.length; i++) npcs[i].rage = 10;
  addBanner('📝', '期末周狂暴模式！', '同学们疯了一样抢座', 'bad', 2.0);
  Sound.skill();
  shake(5, 0.3);
}

function evTickExam(dt) {
  var e = evActive, i;
  e.t -= dt;
  for (i = 0; i < npcs.length; i++) {
    if ((npcs[i].rage || 0) < e.t) npcs[i].rage = e.t;
  }
  if (e.t <= 0) {
    /* 「撑过期末周」是对全场的压力（NPC 集体加速），所以奖励也要发给**每个活着的玩家** ——
       只给 1P 的话，双人时 2P 全程扛了同样的狂暴却一分拿不到。
       单人下 humans 只有 1 个，行为与改造前逐字一致。 */
    var said = false, hu;
    for (i = 0; i < humans.length; i++) {
      hu = humans[i];
      if (!hu.alive) continue;
      hu.score += 100;
      addFloat(CX(hu.c), CY(hu.r) - 54, '+100 撑过期末周', '#7B4B00', FS('fL'), 1.9);
      if (!said) {              /* 横幅/音效全场只出一次，避免双人时刷屏 */
        said = true;
        addBanner('💪', '撑过期末周！', '+100 分', 'milestone', 1.8);
        Sound.milestone();
      }
    }
    evActive = null; evSchedule();
  }
}

/* ---------- 事件（图书馆专属）：期末周开始！ ----------
 * 手册：「期末周开始！」效果 = 座位刷新速度增加。
 * 这个游戏里座位不会被「刷新」掉，所以落地成**抢座速度**：NPC 的步进间隔直接乘 0.6，
 * 座位以肉眼可见的速度被抢走 —— 玩家必须在更短的时间里跑完自己的路线。
 * 与 V2 的 exam（期末周狂暴）是同一个手法：只乘「间隔」，**不改变 Math.random() 的
 * 调用次数**，所以随机序列本身没动，回归指纹照旧可证。
 * 只在图书馆进池子（见 evKinds），教室/食堂永远抽不到它。 */
var libFinalWeek = 0;          /* >0 时 NPC 抢座明显加快（剩余秒数） */

function evStartFinalWeek() {
  evActive = { kind: 'finalweek', t: 10, max: 10 };
  libFinalWeek = 10;
  addBanner('\U0001F4DA', '期末周开始！', '座位抢得更快了 · 撑住', 'bad', 2.2);
  Sound.skill();
  shake(4, 0.25);
}

function evTickFinalWeek(dt) {
  var e = evActive, i, hu, said = false;
  e.t -= dt;
  libFinalWeek = e.t > 0 ? e.t : 0;
  if (e.t > 0) return;
  /* 「撑过期末周」是对全场的压力（NPC 集体加速），奖励要发给**每个活着的玩家** ——
     只给 1P 的话，双人时 2P 扛了同样的压力却一分拿不到。单人下 humans 只有 1 个。 */
  for (i = 0; i < humans.length; i++) {
    hu = humans[i];
    if (!hu.alive) continue;
    hu.score += 120;
    addFloat(CX(hu.c), CY(hu.r) - 54, '+120 撑过期末周', '#33436B', FS('fL'), 1.9);
    if (!said) {              /* 横幅/音效全场只出一次，避免双人时刷屏 */
      said = true;
      addBanner('\U0001F4D6', '期末周结束', '+120 分', 'milestone', 1.8);
      Sound.milestone();
    }
  }
  libFinalWeek = 0;
  evActive = null; evSchedule();
}


/* ---------- 事件（食堂专属）：开饭铃响 / 新菜上线 ----------
 * 手册：
 *   开饭铃响 —— 所有学生速度提升
 *   新菜上线 —— 随机刷新高价值区域
 * 两个都只在食堂进池子（见 evKinds），教室 / 图书馆永远抽不到。 */

/* ---- 开饭铃响 ----
 * 「所有学生速度提升」按字面落地：NPC 和玩家**一起**加速，全场进入快进。
 * 手法与 V2 的 exam / 第六阶段的 finalweek 一致（只乘步进间隔，不增减随机调用），
 * 但方向不同 —— 那两个只加速 NPC（纯压力），这个把玩家也带上，
 * 于是它同时是压力也是机会：抢得更快，长龙也更容易拉长。 */
function evStartBell() {
  evActive = { kind: 'bell', t: SCENE.dine.bellDur, max: SCENE.dine.bellDur };
  dineBell = SCENE.dine.bellDur;
  addBanner('\uD83D\uDD14', '开饭铃响！', '所有学生都跑起来了', 'bad', 2.2);
  Sound.skill(); shake(4, 0.25);
}

function evTickBell(dt) {
  var e = evActive, i, hu, said = false;
  e.t -= dt;
  dineBell = e.t > 0 ? e.t : 0;
  if (e.t > 0) return;
  /* 撑过铃响的奖励发给**每个活着的玩家** —— 双人时两个人都扛了这段快进。
     单人下 humans 只有 1 个，行为与改造前一致。 */
  for (i = 0; i < humans.length; i++) {
    hu = humans[i];
    if (!hu.alive) continue;
    hu.score += SCENE.dine.bellBonus;
    addFloat(CX(hu.c), CY(hu.r) - 54, '+' + SCENE.dine.bellBonus + ' 冲过开饭铃', '#8A5A16', FS('fL'), 1.9);
    if (!said) {              /* 横幅/音效全场只出一次，避免双人时刷屏 */
      said = true;
      addBanner('\uD83D\uDD14', '开饭铃结束', '+' + SCENE.dine.bellBonus + ' 分', 'milestone', 1.8);
      Sound.milestone();
    }
  }
  dineBell = 0;
  evActive = null; evSchedule();
}

/* ---- 新菜上线 ----
 * 「随机刷新高价值区域」：在非走道、还没被占的格子里挑一块 dishW × dishH 的矩形，
 * 整块变成高价值区域（占下饭菜 ×2 且额外加分），持续 dishDur 秒。
 * 全程只走事件自己的流 evRand —— 与 Math.random 完全无关。 */
function dinePickDishArea() {
  var L = SCENE.dine, w = L.dishW, h = L.dishH;
  var tries, c, r, i, j, ok, picked;
  for (tries = 0; tries < 80; tries++) {
    c = 1 + Math.floor(evRand() * Math.max(1, COLS - 2 - w + 1));
    r = 1 + Math.floor(evRand() * Math.max(1, ROWS - 2 - h + 1));
    ok = true;
    for (i = 0; i < w && ok; i++) {
      for (j = 0; j < h && ok; j++) {
        if (isAisle(c + i, r + j)) ok = false;
        else if (grid[I(c + i, r + j)].owner) ok = false;
      }
    }
    if (!ok) continue;
    picked = [];
    for (i = 0; i < w; i++) for (j = 0; j < h; j++) picked.push([c + i, r + j]);
    return picked;
  }
  /* 兜底：残局里可能整块 2×3 都凑不出来（走道 + 已占座把地图切碎了）。
     这时退成几个散点 —— 宁可少刷几格，也不能让事件变成「什么都没发生」。 */
  picked = [];
  for (tries = 0; tries < 160 && picked.length < 3; tries++) {
    c = 1 + Math.floor(evRand() * Math.max(1, COLS - 2));
    r = 1 + Math.floor(evRand() * Math.max(1, ROWS - 2));
    if (isAisle(c, r) || grid[I(c, r)].owner) continue;
    picked.push([c, r]);
  }
  return picked;
}

function evStartNewDish() {
  var L = SCENE.dine;
  dishCells = dinePickDishArea();
  dishTimer = L.dishDur;
  evActive = { kind: 'newdish', t: L.dishDur, max: L.dishDur };
  addBanner('\uD83C\uDF72', '新菜上线！', '高价值区域已刷新', 'good', 2.2);
  Sound.milestone(); shake(3, 0.2);
}

function evTickNewDish(dt) {
  var e = evActive;
  e.t -= dt;
  dishTimer = e.t > 0 ? e.t : 0;
  if (e.t > 0) return;
  dishReset();
  evActive = null; evSchedule();
}


/* ---------- 事件管理器 ---------- */
function evPickKind() {
  var pool = [], i, k, all = evKinds();
  for (i = 0; i < all.length; i++) {
    k = all[i];
    if (k === evLastKind) continue;                        /* 不连着来同一个 */
    if (k === 'clean' && !evHasCleanTarget()) continue;     /* 没东西可清就别选它 */
    /* 临时换教室 = 把全场占座清空重抢。场上一个占座都没有的话，
       这个事件等于「什么都没发生」，白白浪费一次机会，所以也跳过。 */
    if (k === 'swap' && !evHasCleanTarget()) continue;
    pool.push(k);
  }
  if (!pool.length) pool = all.slice();
  return pool[evInt(pool.length)];
}

function evStart() {
  var k = evPickKind();
  evLastKind = k; evDone++;
  if (k === 'roll') evStartRoll();
  else if (k === 'clean') evStartClean();
  else if (k === 'roommate') evStartRoommate();
  else if (k === 'patrol') evStartPatrol();
  /* V2 第六节。走不到这里的可能性由 evKinds() 保证 —— 关掉 V2_EVENTS_ON 时
     这四个根本不在池子里，evPickKind 不会返回它们。 */
  else if (k === 'early') evStartEarly();
  else if (k === 'swap') evStartSwap();
  else if (k === 'canteen') evStartCanteen();
  else if (k === 'exam') evStartExam();
  /* 第六阶段：图书馆专属。走不到这里的可能性由 evKinds() 保证 ——
     不在图书馆时它根本不在池子里，evPickKind 不会返回它。 */
  else if (k === 'finalweek') evStartFinalWeek();
  /* 第七阶段：食堂专属。走不到这里的可能性同样由 evKinds() 保证。 */
  else if (k === 'bell') evStartBell();
  else if (k === 'newdish') evStartNewDish();
  else evStartPatrol();
}

/* 每帧驱动事件。调用点在 update() 的「游戏中」段里 —— 这一节不消耗
 * Math.random()，所以插在哪儿都不会挪动既有的随机序列。
 *
 * V2：**双人模式也跑事件**。事件对场上的每个「人类玩家」各自判定
 * （点名各跑各的、连座各算各的、危险区各扣各的），
 * 所以对战每局也不一样，而不是两个人共用一套结论。 */
function updateEvents(dt) {
  if (!EVENTS_ON) return;
  if (state !== 'play') return;

  var i;
  for (i = evFx.length - 1; i >= 0; i--) {
    evFx[i].t -= dt;
    if (evFx[i].t <= 0) evFx.splice(i, 1);
  }

  /* V1.6 第二阶段：固定时间表的管理员清理。
     放在 evActive 分支**之前** —— 随机排程暂停时 evActive 恒为 null，
     这一节就是整局唯一还会发生的事件。 */
  evCleanSchedTick();

  if (evActive) {
    if (evActive.kind === 'roll') evTickRoll(dt);
    else if (evActive.kind === 'roommate') evTickRoommate(dt);
    else if (evActive.kind === 'patrol') evTickPatrol(dt);
    /* V2 第六节。swap / clean 是瞬时事件，start 里就结束了，没有 tick。 */
    else if (evActive.kind === 'early') evTickEarly(dt);
    else if (evActive.kind === 'canteen') evTickCanteen(dt);
    else if (evActive.kind === 'exam') evTickExam(dt);
    else if (evActive.kind === 'finalweek') evTickFinalWeek(dt);   /* 第六阶段：图书馆专属 */
    else if (evActive.kind === 'bell') evTickBell(dt);             /* 第七阶段：食堂专属 */
    else if (evActive.kind === 'newdish') evTickNewDish(dt);
    return;                     /* 一次只跑一个事件，结束才排下一个 */
  }

  /* V1.6 第二阶段：随机排程暂停 —— 不再有「隔几秒来一个」的事件。
     实现原样保留，setV16(false) 打开 EV_SCHED_ON 就立刻回到 V1.5 的节奏。 */
  if (!EV_SCHED_ON) return;
  evTimer -= dt;
  if (evTimer <= 0) evStart();
}

/* ==========================================================
 * 8c. 随机任务系统（V1.5 第三阶段）
 * ----------------------------------------------------------
 * 手册：「游戏开始生成 3 个随机任务」。从下面 4 个里随机抽 3 个：
 *   A《室友拜托》  连续占 4 个相邻座位    → +300 分
 *   B《充电自由》  占 3 个插座位          → 技能冷却 -30%
 *   C《后排统治者》占 5 个黄金后排        → 称号「后排统治者」
 *   D《低调摸鱼》  连续 30 秒不进老师视线 → 评价「低调摸鱼」
 *
 * 和事件系统同一套硬规矩：自带随机流 taskRand()，整节不许出现 Math.random()。
 * 进度全部「按需从 grid 现算」，不挂进 claimTile —— 既不多消耗随机数，
 * 也不改变任何既有占座行为，所以「原有功能不损坏」这件事是能被指纹证明的。
 * ========================================================== */

var TASKS_ON = true;          /* 总开关：回归测试关掉它，验证 V1 核心循环逐帧不变 */
var TASK_SEED_OVERRIDE = 0;   /* 测试用固定种子，保证任务抽取可复现 */
var taskSeed = 1, taskRoundSeq = 0;

function taskRand() {
  taskSeed = (taskSeed * 1664525 + 1013904223) >>> 0;
  return taskSeed / 4294967296;
}
function taskInt(n) { return Math.floor(taskRand() * n); }

/* 玩家已占的某一类座位数 */
function taskOwned(type) {
  var n = 0;
  for (var i = 0; i < grid.length; i++) {
    if (grid[i].owner === player.id && grid[i].type === type) n++;
  }
  return n;
}

/* 老师视线：正在巡视的视野圈 + 讲台前排「老师眼皮底下」座位的邻域。
 * 加上后者，《低调摸鱼》才不只是一句「别撞上巡视」的空话 ——
 * 讲台正前方本来就写着老师眼皮底下，站过去当然算被看见。 */
function taskInSight() {
  var e = evActive;
  if (e && e.kind === 'patrol') {
    var d = Math.abs(player.c - e.c) + Math.abs(player.r - e.r) * 1.15;
    if (d <= e.rad) return true;
  }
  for (var dr = -1; dr <= 1; dr++) {
    for (var dc = -1; dc <= 1; dc++) {
      var c = player.c + dc, r = player.r + dr;
      if (!inB(c, r)) continue;
      if (grid[I(c, r)].type === 'teacher') return true;
    }
  }
  return false;
}

/* 任务定义表。prog() 返回当前进度，need 是达成线。
 * 发奖只用「无噪声」音效（milestone）—— claim/special/clash/crash/bump 那几条
 * 会去填 noiseBuf，而 noiseBuf 里是 Math.random()，一碰整局 NPC 走位就错位。 */
var TASK_DEFS = [
  {
    id: 'roommate', icon: '🛏️', name: '室友拜托', short: '室友', unit: '连座', color: '#8B5E00',
    need: 4,
    prog: function () { return evLongestRun(); },
    reward: function () {
      player.score += 300;
      addBanner('🛏️', '室友拜托 · 完成！', '连座 4 个 +300', 'milestone', 2.2, true);
      addFloat(CX(player.c), CY(player.r) - 62, '+300 任务完成！', '#1B7A3E', FS('fL'), 2.0);
      addParticles(CX(player.c), CY(player.r), 22, ['#FFD84D', '#FFFFFF', '#FFE9A8'], 1.2, taskRand);
      Sound.milestone();
    }
  },
  {
    id: 'charge', icon: '🔌', name: '充电自由', short: '充电', unit: '插座位', color: '#0B5B8A',
    need: 3, seatType: 'plug',
    prog: function () { return taskPlugProg(); },
    reward: function () {
      player.cdCut = 0.7;
      /* 已经在转的冷却也一起打折 —— 不然「占满插座位」当场什么都感觉不到 */
      for (var i = 0; i < player.skillCd.length; i++) player.skillCd[i] *= 0.7;
      addBanner('🔌', '充电自由 · 完成！', '技能冷却 -30%', 'milestone', 2.2, true);
      addFloat(CX(player.c), CY(player.r) - 62, '技能冷却 -30%！', '#0B5B8A', FS('fL'), 2.0);
      Sound.milestone();
    }
  },
  {
    id: 'backrow', icon: '👑', name: '后排统治者', short: '后排', unit: '黄金后排', color: '#8A6B00',
    need: 5, seatType: 'gold',
    prog: function () { return taskOwned('gold'); },
    reward: function () {
      player.score += 200;
      player.titles.push('后排统治者');
      addBanner('👑', '后排统治者 · 达成！', '最后一排归你了 +200', 'milestone', 2.4, true);
      addFloat(CX(player.c), CY(player.r) - 62, '称号：后排统治者', '#8A6B00', FS('fL'), 2.2);
      Sound.milestone();
    }
  },
  {
    id: 'milkfish', icon: '🎣', name: '低调摸鱼', short: '摸鱼', unit: '秒没被发现', color: '#3E6B4F',
    need: 30,
    prog: function () { return tMilkRun; },
    reward: function () {
      player.score += 150;
      player.titles.push('低调摸鱼');
      addBanner('🎣', '低调摸鱼 · 达成！', '老师一眼没看见你 +150', 'milestone', 2.4, true);
      addFloat(CX(player.c), CY(player.r) - 62, '评价：低调摸鱼', '#3E6B4F', FS('fL'), 2.2);
      Sound.milestone();
    }
  }
];

/* ---------- 场景专属任务池（V1.5 第五阶段补完） ----------
 * 用户要求：随机小任务要跟着场景变，不能一股脑沿用教室那一套。
 * 教室池仍然是上面的 TASK_DEFS（**同一个数组对象**）—— 所以教室的抽取结果
 * 与重构前逐字一致，`--events` 档的 fx 通道不会动。
 * 图书馆 / 食堂各带一条「只有本场景做得到」的招牌任务：
 *   图书馆《静音自习》读安静区行区间；食堂《抢热门菜》读热门位计数。
 * 规矩不变：自带 taskRand、进度按需现算、奖励只用无噪声音效、零 Math.random()。 */
var TASK_DEFS_LIBRARY = [
  {
    id: 'quietseat', icon: '📚', name: '静音自习', short: '静音', unit: '安静区座位', color: '#33436B',
    need: 5,
    prog: function () { return taskQuietOwned(); },
    reward: function () {
      player.score += 250;
      player.titles.push('安静学霸');
      addBanner('📚', '静音自习 · 完成！', '安静区 5 个座位 +250', 'milestone', 2.2, true);
      addFloat(CX(player.c), CY(player.r) - 62, '+250 安静学霸', '#33436B', FS('fL'), 2.0);
      Sound.milestone();
    }
  },
  {
    id: 'longrun', icon: '📖', name: '连座自习', short: '连座', unit: '连座', color: '#3E6B4F',
    need: 5,
    prog: function () { return evLongestRun(); },
    reward: function () {
      player.score += 300;
      addBanner('📖', '连座自习 · 完成！', '连座 5 个 +300', 'milestone', 2.2, true);
      addFloat(CX(player.c), CY(player.r) - 62, '+300 任务完成！', '#3E6B4F', FS('fL'), 2.0);
      addParticles(CX(player.c), CY(player.r), 22, ['#CFE3FF', '#FFFFFF', '#9FC2F0'], 1.2, taskRand);
      Sound.milestone();
    }
  },
  {
    id: 'sockplug', icon: '🔌', name: '抢插座', short: '插座', unit: '插座位', color: '#0B5B8A',
    need: 3, seatType: 'plug',
    prog: function () { return taskPlugProg(); },
    reward: function () {
      player.score += 220;
      player.titles.push('插座猎手');
      addBanner('🔌', '抢插座 · 完成！', '3 个插座位 +220', 'milestone', 2.2, true);
      addFloat(CX(player.c), CY(player.r) - 62, '+220 插座猎手', '#0B5B8A', FS('fL'), 2.0);
      Sound.milestone();
    }
  },
  {
    id: 'quietback', icon: '🪑', name: '后排专座', short: '后排', unit: '黄金后排', color: '#8A6B00',
    need: 5, seatType: 'gold',
    prog: function () { return taskOwned('gold'); },
    reward: function () {
      player.score += 200;
      player.titles.push('后排专座');
      addBanner('🪑', '后排专座 · 达成！', '最后一排归你了 +200', 'milestone', 2.4, true);
      addFloat(CX(player.c), CY(player.r) - 62, '称号：后排专座', '#8A6B00', FS('fL'), 2.2);
      Sound.milestone();
    }
  }
];

var TASK_DEFS_CANTEEN = [
  {
    id: 'hotdish', icon: '🔥', name: '抢热门菜', short: '热门', unit: '热门位', color: '#C1452B',
    need: 3,
    prog: function () { return tHotTaken; },
    reward: function () {
      player.score += 300;
      player.titles.push('干饭王');
      addBanner('🔥', '抢热门菜 · 完成！', '抢到 3 个热门位 +300', 'milestone', 2.2, true);
      addFloat(CX(player.c), CY(player.r) - 62, '+300 干饭王', '#C1452B', FS('fL'), 2.0);
      addParticles(CX(player.c), CY(player.r), 22, ['#FFB03A', '#FFFFFF', '#FF7A2E'], 1.2, taskRand);
      Sound.milestone();
    }
  },
  {
    id: 'feast', icon: '🍚', name: '大快朵颐', short: '连座', unit: '连座', color: '#8B5E00',
    need: 4,
    prog: function () { return evLongestRun(); },
    reward: function () {
      player.score += 250;
      addBanner('🍚', '大快朵颐 · 完成！', '连座 4 个 +250', 'milestone', 2.2, true);
      addFloat(CX(player.c), CY(player.r) - 62, '+250 任务完成！', '#8B5E00', FS('fL'), 2.0);
      Sound.milestone();
    }
  },
  {
    id: 'waitplug', icon: '🔌', name: '充电等位', short: '插座', unit: '插座位', color: '#0B5B8A',
    need: 3, seatType: 'plug',
    prog: function () { return taskPlugProg(); },
    reward: function () {
      player.cdCut = 0.7;
      /* 已经在转的冷却也一起打折 —— 不然占满插座位当场什么都感觉不到 */
      for (var i = 0; i < player.skillCd.length; i++) player.skillCd[i] *= 0.7;
      addBanner('🔌', '充电等位 · 完成！', '技能冷却 -30%', 'milestone', 2.2, true);
      addFloat(CX(player.c), CY(player.r) - 62, '技能冷却 -30%！', '#0B5B8A', FS('fL'), 2.0);
      Sound.milestone();
    }
  },
  {
    id: 'booth', icon: '👑', name: '包间雅座', short: '雅座', unit: '黄金后排', color: '#8A6B00',
    need: 5,
    prog: function () { return taskOwned('gold'); },
    reward: function () {
      player.score += 200;
      player.titles.push('包间雅座');
      addBanner('👑', '包间雅座 · 达成！', '最后一排归你了 +200', 'milestone', 2.4, true);
      addFloat(CX(player.c), CY(player.r) - 62, '称号：包间雅座', '#8A6B00', FS('fL'), 2.2);
      Sound.milestone();
    }
  }
];

/* 按场景取任务池。教室返回的就是原来的 TASK_DEFS（同一个数组对象），
 * 所以「教室任务抽取结果不变」是结构上保证的，不靠调参。
 *
 * V1.6 第二阶段：老师巡视暂停之后，《低调摸鱼》失去了它的前提
 * （「连续 30 秒不进老师视线」—— 巡视事件不跑了，只剩讲台前排那几个固定座位），
 * 所以教室池里暂时把它摘掉。**定义仍在 TASK_DEFS 里原样保留**，
 * setV16(false) 把 TASK_MILKFISH_ON 打开，它立刻回到池子里。
 * 摘掉的是池子（新数组），不是 TASK_DEFS 本身 —— 老基线因此不受影响。 */
var TASK_DEFS_CLASSROOM = null;    /* 教室池的「摘掉摸鱼」版本，懒构建一次 */
/* C（2026-10-04）：这条任务「有没有补救办法」？
 * 依赖某类座位的任务有两种会变成**永久无解**的情况：
 *   ① 全场该类型座位数 < need              → 结构性不可能，再努力也完不成
 *   ② 刚好等于 need，且清理腾不出特殊座位   → 被 NPC 占走一个就再也拿不到（不能抢别人的座）
 * 文档：「暂时没有补救办法的任务，先不要抽到。」
 * ⚠️ 开关关掉时（= V1.5 档）恒返回 true → 池子原样、长度不变 → 老基线逐字命中。
 * ⚠️ 默认配置下 A 是开着的，②永远不成立 → 这个过滤器实际上**不生效**（池子原样返回）。
 *    它只在有人刻意关掉 A 的时候才起作用 —— 这正是文档要的兜底。 */
function taskHasRemedy(def) {
  if (!TASK_PLUG_CUMUL_ON) return true;       /* V1.5 档：不过滤，池子长度不变 */
  if (!def.seatType) return true;             /* 不依赖特定座位类型的任务恒有解 */
  var total = 0, i;
  for (i = 0; i < grid.length; i++) if (grid[i].type === def.seatType) total++;
  if (total < def.need) return false;                           /* ① */
  if (total === def.need && !EV_CLEAN_SPECIAL_ON) return false;  /* ② */
  return true;
}

/* 把「无解」的任务从池子里摘掉。
 * ⚠️ 一条都没摘掉时**原样返回同一个数组对象** —— 教室池「返回 TASK_DEFS 本身」
 *    是个结构性事实（经验手册 §8.3），别让一个恒等过滤把它降级成新数组。
 * ⚠️ 全被摘光时也原样返回：宁可抽到一条难任务，也不能没有任务。 */
function taskPoolRemedy(pool) {
  var out = pool.filter(taskHasRemedy);
  if (out.length === pool.length) return pool;   /* 恒等 → 保持同一个对象 */
  return out.length ? out : pool;
}

function taskPool() {
  if (sceneIs('library')) return taskPoolRemedy(TASK_DEFS_LIBRARY);
  if (sceneIs('canteen')) return taskPoolRemedy(TASK_DEFS_CANTEEN);
  if (!TASK_MILKFISH_ON) {
    if (!TASK_DEFS_CLASSROOM) {
      TASK_DEFS_CLASSROOM = TASK_DEFS.filter(function (t) { return t.id !== 'milkfish'; });
    }
    return taskPoolRemedy(TASK_DEFS_CLASSROOM);
  }
  return taskPoolRemedy(TASK_DEFS);
}

/* 玩家在「安静区」里占下的座位数（图书馆招牌任务的进度）。
 * 纯读 grid + 行区间，按需现算 —— 不挂进 claimTile，不多消耗一个随机数。 */
function taskQuietOwned() {
  var z = sceneQuietRows();
  if (!z) return 0;
  var n = 0;
  for (var i = 0; i < grid.length; i++) {
    if (grid[i].owner !== player.id) continue;
    var r = Math.floor(i / COLS);
    if (r >= z.r0 && r <= z.r1) n++;
  }
  return n;
}


var taskList = [];      /* 本局抽中的 3 个任务（TASK_DEFS 的引用） */
var taskDone = [];      /* 与 taskList 等长：是否已完成 */
var taskProg = [];      /* 每帧刷新的进度快照（渲染用） */

/* ---------- C（2026-10-04）：插座任务改按「本局累计抢到的不同插座」统计 ----------
 * 文档：「插座任务按这一局累计抢到的不同插座统计，清理不倒扣进度，
 *       同一个插座反复抢也不重复增加进度」。
 * 用**格子下标**做键 —— 同一个格子反复抢只算一次；清理把 owner 抹掉也不影响已记下的进度。
 * 纯对象读写，零随机消耗。TASK_PLUG_CUMUL_ON 关掉时这两个值完全不参与任何判定。 */
var plugClaimedSet = {};
var plugClaimedCount = 0;

/* 插座任务的进度读数。开关关掉 → 逐字回到 V1.5 的「当前持有几个插座位」。 */
function taskPlugProg() {
  return TASK_PLUG_CUMUL_ON ? plugClaimedCount : taskOwned('plug');
}

/* 1C（2026-10-15）：这一轮清理要不要给插座任务「保底补救」？
 *   条件全部满足才为真：① 本局抽到的任务里有一条 `charge`（充电自由）且还没完成；
 *   ② 玩家还没抢够（`plugClaimedCount < need`）。
 *   ⚠️ 纯读，零随机消耗。`TASK_PLUG_CUMUL_ON` 关掉时（= 老口径「当前持有数」，
 *      被清掉就倒退、不存在「永久无解」）直接返回 false —— 与 v36 逐字一致。 */
function taskPlugRemedyWanted() {
  if (!TASK_PLUG_CUMUL_ON) return false;
  var i;
  for (i = 0; i < taskList.length; i++) {
    if (taskList[i] && taskList[i].id === 'charge' && !taskDone[i]) {
      return plugClaimedCount < taskList[i].need;
    }
  }
  return false;
}
var taskFlash = [];     /* 刚完成时的闪一下（秒） */
var taskRefillAt = [];  /* 与 taskList 等长：完成后还有几秒补新任务（0=不补） */
var TASK_REFILL_DELAY = 2.5;  /* 完成后先亮 2.5s 的 ✓，再补新任务，避免「刚完成就消失」 */
var tMilkRun = 0;       /* 《低调摸鱼》当前连续安全秒数 */
var tHotTaken = 0;      /* 《抢热门菜》本局抢到的热门位数（食堂专属任务的进度）。
                           在 claimFeedbackPlayer 的 hotHit 分支里 +1 —— 那里本来就只有食堂走得到，
                           且只做自增、不掷骰子，所以对教室/图书馆零影响。 */

/* 抽任务：洗牌取前 TASK_COUNT 个，走任务自己的随机流。
 * 池子按场景取（taskPool()）—— 教室拿到的是 TASK_DEFS 本身，元素与顺序都不变，
 * 所以教室的抽取结果与「没有场景任务池」时逐字一致。
 *
 * V1.6 第二阶段：TASK_COUNT = 1 —— 一局只抽 1 个任务，整局固定不变。
 * 这里改的是**真的少抽**，不是「抽 3 个只画 1 个」：
 * taskList 的长度就是 1，面板、结算、奖励逻辑读到的都是同一个长度。 */
function taskPick() {
  var pool = taskPool().slice(), i, j, tmp;
  for (i = pool.length - 1; i > 0; i--) {
    j = taskInt(i + 1);
    tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  taskList = pool.slice(0, TASK_COUNT);
  taskDone = []; taskProg = []; taskFlash = []; taskRefillAt = [];
  for (i = 0; i < taskList.length; i++) {
    taskDone.push(false); taskProg.push(0); taskFlash.push(0); taskRefillAt.push(0);
  }
  for (i = 0; i < taskList.length; i++) taskProg[i] = taskList[i].prog();
}

/* 任务完成后立刻补一个新任务，保持「3 个常驻」—— 这样一局里任务会滚动出现，
 * 不会出现「前 20 秒做完 3 个就再没目标」的空窗（用户反馈任务出现频率太低）。
 * 只从「当前没在跑的、且还没达成」的里抽，所以 3 个槽位 + 4 种任务永远不重复，
 * 也避免「玩家已满足全部条件 → 补的任务当场又完成 → 每帧无限补、无限刷分」的死循环。
 * 抽不到（剩下的任务都已完成）就退回、留着当前已完成的槽位。走 taskRand（独立随机流），不碰 Math.random。
 *
 * V1.6 第二阶段：TASK_REFILL_ON = false —— 不再补新任务，一局就那一个，
 * 做完就做完（未完成也不惩罚）。函数原样保留，setV16(false) 立刻恢复滚动补任务。 */
function taskRefill(slot) {
  if (!TASK_REFILL_ON) return;
  var active = {};
  for (var k = 0; k < taskList.length; k++) if (k !== slot) active[taskList[k].id] = true;
  var pool = taskPool().filter(function (t) {
    if (active[t.id]) return false;
    return t.prog() < t.need;            /* 已达成的任务不再补 */
  });
  if (!pool.length) return;             /* 都达成了 → 不补，避免无限循环刷分 */
  var idx = taskInt(pool.length);
  taskList[slot] = pool[idx];
  taskDone[slot] = false;
  taskProg[slot] = taskList[slot].prog();
  taskFlash[slot] = 0.6;
}

function tasksReset() {
  taskRoundSeq++;
  /* C：插座任务的「本局累计不同插座」每局清零。放在最前面 ——
     关掉任务时也要清，否则上一局的进度会漏进新一局。零随机消耗。 */
  plugClaimedSet = {}; plugClaimedCount = 0;
  if (TASK_SEED_OVERRIDE) taskSeed = TASK_SEED_OVERRIDE >>> 0;
  else {
    taskSeed = ((Date.now() & 0x7fffffff) ^ (taskRoundSeq * 7919)) >>> 0;
    if (!taskSeed) taskSeed = 1;
  }
  tMilkRun = 0;
  tHotTaken = 0;
  taskPick();

  /* 关掉任务时一条横幅都不许加：V1 档要拿到「和 V1 逐帧一致」的 fx 通道 */
  if (!TASKS_ON) { taskList = []; taskDone = []; taskProg = []; taskFlash = []; taskRefillAt = []; return; }

  /* 开场把本局的任务报一遍 —— 只读 taskList，不消耗任何随机数。
     V1.6：TASK_COUNT = 1 → 这里报的就是那一个任务，横幅与面板口径一致。 */
  var names = [];
  for (var i = 0; i < taskList.length; i++) names.push(taskList[i].name);
  /* 教室保持「今日任务」四个字不变 —— `--events` 档的 fx 通道靠它逐字对齐；
     图书馆 / 食堂才带上场景名，让玩家一眼看出换了玩法。 */
  var head = sceneIs('classroom') ? '今日任务' : (SCENE.name + ' · 今日任务');
  addBanner('📋', head, names.join(' · '), 'good', 3.0);
}

/* 每帧驱动。调用点紧挨 updateEvents —— 同样不消耗 Math.random()，插哪儿都安全。 */
function updateTasks(dt) {
  if (!TASKS_ON) return;
  if (state !== 'play') return;
  if (isVersus()) return;          /* 第三阶段同样只做单人（手册：不提前开发双人） */

  for (var f = 0; f < taskFlash.length; f++) {
    if (taskFlash[f] > 0) taskFlash[f] = Math.max(0, taskFlash[f] - dt);
  }

  /* 延迟补任务：完成后的 ✓ 先亮 TASK_REFILL_DELAY 秒，再换上新任务。
   * 直接当场补会把「已完成」状态一帧内冲掉，结算页和实时 ✓ 都读不到。
   * V1.6 第二阶段：TASK_REFILL_ON = false → 整段跳过，做完的任务会一直挂着 ✓，
   * 一局就这一个目标，不会滚出新的来。 */
  if (TASK_REFILL_ON) {
    for (var r = 0; r < taskRefillAt.length; r++) {
      if (taskRefillAt[r] > 0) {
        taskRefillAt[r] -= dt;
        if (taskRefillAt[r] <= 0) { taskRefillAt[r] = 0; taskRefill(r); }
      }
    }
  }

  /* 《低调摸鱼》：连续安全时间，进了老师视线就从头再来 */
  if (taskInSight()) tMilkRun = 0;
  else tMilkRun += dt;

  for (var i = 0; i < taskList.length; i++) {
    if (taskDone[i]) continue;
    var cur = taskList[i].prog();
    taskProg[i] = cur;
    if (cur >= taskList[i].need) {
      taskDone[i] = true;
      taskProg[i] = taskList[i].need;
      taskFlash[i] = 0.8;
      taskList[i].reward();
      /* V1.6：不补任务 → 不需要「先亮一会儿 ✓ 再换人」，直接把完成态留住 */
      if (TASK_REFILL_ON) taskRefillAt[i] = TASK_REFILL_DELAY;
    }
  }
}

/* ==========================================================
 * 8f. 图书馆专属规则（V1.5 第六阶段）
 * ----------------------------------------------------------
 * 手册：「图书馆的核心玩法是抢占学习资源，不是简单抢座」。落地成三件事：
 *   ① 三个区域（安静区 / 插座区 / 小组讨论区）各有各的收益与代价
 *   ② 安静值系统：在安静区里走动就掉，掉过头会被管理员驱赶
 *   ③ 特殊事件「期末周开始！」：座位刷新速度增加
 *      （定义在下面「事件（图书馆专属）：期末周开始！」一节，抽池见 evKinds）
 *
 * 硬规矩与前面几节完全一致：
 *   · 零 Math.random()（管理员驱赶用「隔一个清一个」的确定性扫法，连 RNG 都不用）
 *   · 进度全部按需现算，不额外改变任何既有路径的执行次数
 *   · 教室 / 食堂 SCENE.lib 为 null → 每个函数第一行就返回
 *   · LIB_RULES_ON 总开关，让回归测试能整组关掉
 * ========================================================== */

var LIB_RULES_ON = true;

function libOn() { return LIB_RULES_ON && !!SCENE.lib; }

/* 插座区：最左 plugCols 比例的那些列（插座本来就长在墙上） */
function libPlugColMax() {
  if (!SCENE.lib) return 0;
  return Math.max(1, Math.floor(COLS * SCENE.lib.plugCols));
}
/* 小组讨论区：最下 (1 - groupRow) 比例的那些行。
 * ⚠️ 必须**避开安静区**：17 行时安静区是 4~12 行，而 floor(17*0.72) 也是 12 ——
 * 直接取百分比会让第 12 行同时属于两个区域，加成规则就说不清了
 * （「安静区 ×1.4 又 +150」到底算哪个？）。所以这里把起点推到安静区下边界之后。 */
function libGroupRowMin() {
  if (!SCENE.lib) return ROWS;
  var byPct = Math.floor(ROWS * SCENE.lib.groupRow);
  var q = sceneQuietRows();
  if (q && byPct <= q.r1) return q.r1 + 1;
  return byPct;
}

function inLibQuiet(c, r) {
  if (!libOn()) return false;
  var z = sceneQuietRows();
  return !!z && r >= z.r0 && r <= z.r1;
}
function inLibPlugZone(c, r) {
  if (!libOn()) return false;
  return c >= 1 && c <= libPlugColMax();
}
function inLibGroupZone(c, r) {
  if (!libOn()) return false;
  return r >= libGroupRowMin() && r <= ROWS - 1;
}
/* 一格属于哪个区域（渲染与测试用）。优先级：安静区 > 讨论区 > 插座区 */
function libZoneName(c, r) {
  if (inLibQuiet(c, r)) return 'quiet';
  if (inLibGroupZone(c, r)) return 'group';
  if (inLibPlugZone(c, r)) return 'plug';
  return null;
}

/* ---------- 安静值 ----------
 * 存在 Actor 自己身上（a.calm），所以双人模式下两个玩家各算各的。
 * 掉值发生在「检测到最近换过格子」时 —— 纯观察，完全不碰移动代码。
 * ⚠️ 2026-10-03 修：原来是「这一帧有没有换格」，而一步要 181ms（≈11 帧），
 *    于是 1 帧掉、10 帧回 → 持续走动反而净回血，驱赶永远不会触发。
 *    现在用 calmHold 把「在走动」这个判定保持一小段（见 SCENE.lib.calmMoveHold）。 */
function libCalmInit(a) {
  if (!libOn()) return;
  if (typeof a.calm !== 'number') a.calm = SCENE.lib.calmMax;
  if (typeof a.calmC !== 'number') { a.calmC = a.c; a.calmR = a.r; }
  if (typeof a.calmHold !== 'number') a.calmHold = 0;
}
function libCalmResetAll() {
  for (var i = 0; i < humans.length; i++) {
    var h = humans[i];
    h.calm = SCENE.lib ? SCENE.lib.calmMax : 0;
    h.calmC = h.c; h.calmR = h.r;
    h.calmHold = 0;
    h.libDiscuss = 0;
  }
}

/* 管理员驱赶：扣分 + 清掉他在安静区的一半座位 + 原地罚站。
 * 清座用「隔一个清一个」的确定性扫法 —— 不洗牌、不掷骰子，一个随机数都不用。 */
function libEvict(h) {
  var L = SCENE.lib, seen = 0, i, c, r;
  for (i = 0; i < grid.length; i++) {
    if (grid[i].owner !== h.id) continue;
    c = i % COLS; r = Math.floor(i / COLS);
    if (!inLibQuiet(c, r)) continue;
    if (seen % 2 === 1) {
      grid[i].owner = null; grid[i].item = ''; grid[i].hm = 0; grid[i].hmh = 0;
      h.seatCount = Math.max(0, h.seatCount - 1);
    }
    seen++;
  }
  h.score = Math.max(0, h.score + L.calmEvictScore);
  h.calm = L.calmMax * 0.6;
  h.freeze = L.calmEvictFreeze;
  addBanner('📕', '管理员来了！', '安静值过低 · ' + L.calmEvictScore + ' 分', 'bad', 2.2, true);
  addFloat(CX(h.c), CY(h.r) - 58, '请保持安静！', '#B03030', FS('fL'), 2.0);
  Sound.ui();
  shake(4, 0.25);
}

function updateLibCalm(dt) {
  if (!libOn()) return;
  if (state !== 'play') return;
  var L = SCENE.lib;
  for (var i = 0; i < humans.length; i++) {
    var h = humans[i];
    if (!h.alive) continue;
    libCalmInit(h);
    var stepped = (h.c !== h.calmC || h.r !== h.calmR);
    h.calmC = h.c; h.calmR = h.r;
    /* 「算不算在走动」要**保持**一小段：跨了一格就把窗口续满，窗口内一律算在走。
       逐帧判的话，一步 181ms ≈ 11 帧里只有 1 帧算「走」，其余 10 帧按「站着」回血
       → 净回血，持续走动永远掉不到 calmEvict（2026-10-03 修的就是这个）。 */
    if (stepped) h.calmHold = L.calmMoveHold;
    else h.calmHold = Math.max(0, h.calmHold - dt);
    var moving = LIB_FIX_ON ? (h.calmHold > 0) : stepped;
    if (inLibQuiet(h.c, h.r)) {
      /* 在安静区：走动就掉（按秒），真正停下才慢慢回 */
      if (moving) h.calm -= L.calmMoveDrain * dt;
      else h.calm += L.calmQuietRegen * dt;
    } else {
      h.calm += L.calmRegen * dt;
    }
    if (h.calm > L.calmMax) h.calm = L.calmMax;
    if (h.calm <= L.calmEvict) libEvict(h);
  }
}

/* ---------- 小组讨论区：占一格攒一次「讨论」，攒够就追加一个额外任务 ---------- */
function libPickExtraTask() {
  var pool = taskPool().filter(function (t) {
    for (var i = 0; i < taskList.length; i++) if (taskList[i].id === t.id) return false;
    return t.prog() < t.need;
  });
  if (!pool.length) return null;
  return pool[taskInt(pool.length)];      /* taskRand 是任务自己的流，与 Math.random 无关 */
}

function libDiscussTick(h) {
  if (!libOn() || !TASKS_ON || isVersus()) return;
  /* V1.6 第二阶段：一局只做一个任务，讨论区不再往列表里塞额外任务。
     计数也一并停掉 —— 它除了喂这个取模判断之外没有别的用处，
     留着只会让「讨论区在干活」变成一句假话。整段实现原样保留，
     setV16(false) 打开 TASK_EXTRA_ON 立刻恢复。 */
  if (!TASK_EXTRA_ON) return;
  var L = SCENE.lib;
  h.libDiscuss = (h.libDiscuss || 0) + 1;
  if (h.libDiscuss % L.discussEvery !== 0) return;
  if (taskList.length >= L.extraTaskMax) return;
  var t = libPickExtraTask();
  if (!t) return;
  taskList.push(t); taskDone.push(false);
  taskProg.push(t.prog()); taskFlash.push(0.8); taskRefillAt.push(0);
  addBanner('💬', '讨论区带来新任务！', t.name, 'good', 1.8);
  addFloat(CX(h.c), CY(h.r) - 58, '额外任务 +1', '#2E7D5B', FS('fM'), 1.8);
  Sound.milestone();
}

/* 占座时的区域加成。纯算术，零随机消耗；教室 / 食堂进来第一行就返回。
 * 注意只在 base 为正时乘倍率 —— 负分座位（如靠门位）不该被安静区放大。 */
function libClaimBonus(c, r, t, base) {
  if (!libOn()) return base;
  var L = SCENE.lib;
  if (inLibQuiet(c, r)) { if (base > 0) base *= L.quietSeatMult; }
  else if (t.type === 'plug' && inLibPlugZone(c, r)) base += L.plugBonus;
  if (inLibGroupZone(c, r)) base += L.groupBonus;
  return base;
}


/* ==========================================================
 * 8h. 食堂专属规则（V1.5 第七阶段）
 * ----------------------------------------------------------
 * 手册：「核心玩法：抢热门位置。不是抢座，而是抢资源」。
 * 落地成四件事：
 *   ① 四个区域（快速窗口 / 热门档口 / 窗边桌 / 双人桌）各有各的身份
 *   ② 饭菜资源：占座产出饭菜，饭菜再按固定汇率折成分
 *   ③ 排队长龙：路线**不断**地延伸，队伍就越长，每格饭菜按队伍规模放大
 *   ④ 两个特殊事件（见下面「事件（食堂专属）」一节）
 *
 * 硬规矩与前几节完全一致：
 *   · 零 Math.random()（区域 / 饭菜 / 长龙全是纯算术，一个随机数都不掷）
 *   · 进度按需现算，不改变任何既有路径的执行次数
 *   · 教室 / 图书馆 SCENE.dine 为 null → 每个函数第一行就返回
 *   · DINE_RULES_ON 总开关，让回归测试能整组关掉
 * ========================================================== */

var DINE_RULES_ON = true;

function dineOn() { return DINE_RULES_ON && !!SCENE.dine; }

/* ---------- 四区域边界 ----------
 * 行分三段（快速窗口 / 中段 / 双人桌），中段再按列分两带（热门档口 / 窗边桌）。
 * 这样切出来的四个区域**结构上互不重叠** —— 「这一格算哪个区域」永远只有一个答案，
 * 不需要靠优先级去猜。图书馆那次安静区与讨论区抢同一行，就是因为两边各自按百分比算。 */
function dineFastRowMax() {
  if (!SCENE.dine) return 0;
  return Math.max(1, Math.floor(ROWS * SCENE.dine.fastRows));
}
function dineBottomRowMin() {
  if (!SCENE.dine) return ROWS;
  var byPct = ROWS - Math.max(1, Math.floor(ROWS * SCENE.dine.bottomRows));
  /* 顶部 / 底部两段不能重叠 —— 紧凑版行数少的时候尤其危险 */
  return Math.max(dineFastRowMax() + 1, byPct);
}
function dineStallColMax() {
  if (!SCENE.dine) return 0;
  return Math.max(1, Math.floor(COLS * SCENE.dine.stallCols));
}
function dineWindowColMin() {
  if (!SCENE.dine) return COLS;
  var byPct = COLS - Math.max(1, Math.floor(COLS * SCENE.dine.windowCols));
  /* 中段左右两带不能碰面 —— 紧凑版列数少的时候尤其危险 */
  return Math.max(dineStallColMax() + 1, byPct);
}

function inDineFast(c, r) {
  if (!SCENE.dine) return false;
  return r >= 1 && r <= dineFastRowMax();
}
function inDinePair(c, r) {
  if (!SCENE.dine) return false;
  return r >= dineBottomRowMin() && r <= ROWS - 1;
}
function inDineStall(c, r) {
  if (!SCENE.dine) return false;
  return r > dineFastRowMax() && r < dineBottomRowMin() && c >= 1 && c <= dineStallColMax();
}
function inDineWindow(c, r) {
  if (!SCENE.dine) return false;
  return r > dineFastRowMax() && r < dineBottomRowMin() && c >= dineWindowColMin() && c <= COLS - 2;
}
/* 一格属于哪个区域（渲染与测试用）。四个判定两两互斥，所以这里不需要优先级。 */
function dineZoneName(c, r) {
  if (!dineOn()) return null;
  if (inDineFast(c, r)) return 'fast';
  if (inDinePair(c, r)) return 'pair';
  if (inDineStall(c, r)) return 'stall';
  if (inDineWindow(c, r)) return 'window';
  return null;
}

/* ---------- 新菜上线刷出来的高价值区域 ---------- */
var dishCells = [];             /* [[c,r],...] 当前高价值区域 */
var dishTimer = 0;
var dineBell = 0;               /* 「开饭铃响」剩余秒数（>0 时全场加速） */
function dishReset() { dishCells = []; dishTimer = 0; }
function isDishCell(c, r) {
  for (var i = 0; i < dishCells.length; i++) {
    if (dishCells[i][0] === c && dishCells[i][1] === r) return true;
  }
  return false;
}

/* ---------- 饭菜产量 ----------
 * 区域给基础产量，热门位 / 新菜区域再各乘一档。
 * 两者可以叠加 —— 正好刷在一起就是「天选之位」。 */
function dineFoodOf(c, r) {
  var L = SCENE.dine, f = L.foodPerSeat;
  if (inDineFast(c, r)) f += L.fastFood;
  else if (inDineStall(c, r)) f += L.stallFood;
  if (isHotCell(c, r)) f *= L.hotCellFoodMult;
  if (isDishCell(c, r)) f *= L.dishFoodMult;
  return f;
}

/* ---------- 排队长龙 ----------
 * 「路线越长：队伍越大」。所以队伍记的是**当前这条不断的路线**有多长：
 * 新占的格与上一格四邻相邻 → 队伍 +1；不相邻（断了）→ 从 1 重新排起。
 * 双人桌一次来俩，所以额外 +（pairQueue - 1）。
 * 断线重置是这套机制的全部张力所在 —— 玩家得规划一条连续的路，而不是见缝插针。 */
function dineQueueMult(h) {
  var L = SCENE.dine;
  var q = Math.min(h.queue || 0, L.queueMax);
  return 1 + q * L.queueStep;
}
function dineQueuePush(h, c, r) {
  if (!dineOn()) return;
  var L = SCENE.dine;
  var adj = (Math.abs(c - h.lastDineC) + Math.abs(r - h.lastDineR)) === 1;
  h.run = adj ? (h.run || 0) + 1 : 1;
  if (inDinePair(c, r)) h.run += (L.pairQueue - 1);
  h.lastDineC = c; h.lastDineR = r;
  var before = h.queue || 0;
  /* 队伍 = 排在你**后面**的人，所以是 run - 1：占下第一格时队伍还没成型，
     倍率正好是 ×1.00，玩家一眼就懂「从 1 开始长」。 */
  var q = Math.min(Math.max(0, h.run - 1), L.queueMax);
  h.queue = q;
  /* 每长 milestone 格给一次「长龙又长了」的反馈。
     用飘字而不是横幅：双人局里两个玩家各排各的队，横幅会互相刷屏；
     飘字挂在自己的坐标上，天然分开。每局最多响 queueMax/milestone 次，不吵。 */
  if (q > before && before > 0 &&
      Math.floor(q / L.queueMilestone) > Math.floor(before / L.queueMilestone)) {
    addFloat(CX(c), CY(r) - S36(30), '长龙 ' + q + ' 连！', '#C98A1E', FS('fL'), 1.6);
    Sound.milestone();
  }
}

/* 占座时的食堂结算，返回新的 gain。
 * ⚠️ 必须排在热门位结算**之前**调用 —— 热门位一旦被占就从 hotCells 里摘掉了，
 *    之后再问「这格是不是热门位」永远是 false，饭菜的 ×2 就白丢了。 */
function dineClaimBonus(c, r, t, h, base) {
  if (!dineOn()) return base;
  var L = SCENE.dine;
  dineQueuePush(h, c, r);
  if (inDineWindow(c, r)) { if (base > 0) base *= L.windowSeatMult; }   /* 窗边桌：分高 */
  var food = Math.round(dineFoodOf(c, r) * dineQueueMult(h));
  h.food = (h.food || 0) + food;
  if (isDishCell(c, r)) base += L.dishScore;
  return base + food * L.foodScore;
}

/* ---------- 玩家走过的路径（排队长龙的「形」） ----------
 * 长龙要画在**玩家走过的路径**上，而不是「最近占下的那几个座位」——
 * 后者会被走道和被 NPC 插空的格子打断，画出来是一团散点；
 * 而路径天然是逐格相连的（玩家一步只走一格），所以画出来一定是一条连续的队。
 * 纯位置记录，不掷任何随机数；每帧最多 append 一次。 */
function updateDineTrail(dt) {
  if (!dineOn()) return;
  var L = SCENE.dine, cap = L.queueDrawMax + 2, i, h, tr, last;
  for (i = 0; i < humans.length; i++) {
    h = humans[i];
    if (!h.alive) continue;
    if (!h.trail) h.trail = [];
    tr = h.trail;
    last = tr.length ? tr[tr.length - 1] : null;
    if (!last || last.c !== h.c || last.r !== h.r) {
      tr.push({ c: h.c, r: h.r });
      while (tr.length > cap) tr.shift();
    }
  }
}

function dineResetAll() {
  var i, h;
  for (i = 0; i < humans.length; i++) {
    h = humans[i];
    h.food = 0; h.queue = 0; h.run = 0;
    h.lastDineC = -99; h.lastDineR = -99;
    h.trail = [];
  }
  dishReset();
  dineBell = 0;
}


/* ==========================================================
 * 8i. 新手引导（第九阶段 P1-4）
 * ----------------------------------------------------------
 * 文档 §十 要求三步引导：WASD/方向键移动 → 经过空位即可占座 →
 * 别撞回自己占过的位置，并且「30 秒内结束、之后不再重复」。
 * 改之前这个系统完全不存在（grep tutorial / 引导 / firstRun 零命中），
 * 替代品是开始页底部一行小字 —— 属于「读文字」，不是「做中学」。
 *
 * 四条设计约束：
 *   1. **做中学**：每一步由玩家的真实行为推进（动了 / 占到座了 / 稳住了），
 *      不是弹一页说明让他自己读。
 *   2. **进度按需现算**：只读 player.c / player.r / player.seatCount，
 *      绝不挂进 tryMovePlayer 或 claimTile —— 那会改变既有调用序列，
 *      整局随机流就重排了（这是本项目最贵的一种错）。
 *   3. **零 Math.random 消耗**：整个模块只有「读状态」和「画东西」。
 *   4. **只在单人第一局出现**：双人模式两个人都在忙，弹引导只会添乱；
 *      联网对战更不该出现（模拟在房主那边跑）。
 *
 * 为什么画在画布上而不是做成 DOM 卡片：它要**贴着玩家走** ——
 * 「指的就是你正在操控的那个」这件事是引导的一半价值，DOM 层做不到。
 * 顺带还避开了顶部横幅区与底部状态条的位置争夺。
 * ========================================================== */

var TUTORIAL_ON = true;   /* 总开关：回归测试关掉它，验证不影响既有循环 */
var TUT_KEY = 'zhanzuo_tut_v1';  /* 看过就写这个键，之后不再出现 */
var TUT_LIMIT = 30;       /* 文档 §十：30 秒内结束（超时兜底，正常几秒就走完） */
var TUT_STEP3_SEC = 4.5;  /* 第三步是「别做什么」，没有可观测的完成动作 → 给固定展示时长 */

/* 三步文案。⚠️ 不放 emoji：画布上中文与 emoji 是两个字体栈，而
 * @napi-rs/canvas 没有 emoji 字体，渲染截图里会变成方框。
 * 序号也刻意不用 ①②③ —— 用矢量圆点画，任何环境都成立。 */
var TUT_STEPS = [
  { text: 'WASD / 方向键 移动',   sub: '先走动起来' },
  { text: '走过空位，座位就归你', sub: '占得越多，分数越高' },
  /* V1.6 第一阶段：第三步原来是「别撞回自己占过的座位」——
   * 自己的座位现在是所有人的通路，这条提醒已经彻底作废。
   * 换成真正会出事的那一条：撞别人的占座（单人直接出局）。 */
  { text: '别撞别人的占座',       sub: '撞上去就出局' }
];
var TUT_TOUCH_MAIN = '拖动屏幕 移动';   /* 触屏设备上第一步换个说法 */

var tutSeen = false;      /* 本次会话是否已看过（开机时从 localStorage 读一次） */
var tutArmed = false;     /* 本局满足「该出现」的条件（没看过 + 单人 + 非演示局） */
var tutActive = false;    /* 正在展示 */
var tutStep = 0;
var tutT = 0;             /* 本步已展示时长 */
var tutTotal = 0;         /* 本次引导总时长，用于 30 秒兜底 */
var tutSpawnC = -1, tutSpawnR = -1;
var tutBaseSeats = 0;

function tutLoad() {
  try { tutSeen = localStorage.getItem(TUT_KEY) === '1'; } catch (e) { tutSeen = false; }
}

function tutMarkSeen() {
  if (tutSeen) return;
  tutSeen = true;
  try { localStorage.setItem(TUT_KEY, '1'); } catch (e) {}
}

/* 每局开局调用（resetGame 里）。演示局（开始页那些自己跑的 NPC）不算一局。 */
function tutResetRound(isDemo) {
  tutActive = false; tutStep = 0; tutT = 0; tutTotal = 0;
  tutArmed = TUTORIAL_ON && !tutSeen && !isDemo && !isVersus();
}

/* 真正开打（state 从 'count' 进 'play'）时才开始计时 ——
 * 倒计时那 3 秒玩家还动不了，算进去等于白吃掉 3 秒的引导窗口。 */
function tutBegin() {
  if (!tutArmed || tutActive) return;
  tutActive = true; tutStep = 0; tutT = 0; tutTotal = 0;
  tutSpawnC = player ? player.c : -1;
  tutSpawnR = player ? player.r : -1;
  tutBaseSeats = player ? player.seatCount : 0;
}

function tutFinish() {
  if (!tutActive) return;
  tutActive = false;
  tutMarkSeen();
}

/* 局中途结束（撞车 / 被围死 / 时间到）。
 * 只有走到第 3 步才算「看完了」；刚开局就撞车的新手恰恰是最需要再看一遍的人，
 * 所以那种情况不写存档，下一局再给一次。 */
function tutAbort() {
  if (!tutActive) return;
  tutActive = false;
  if (tutStep >= 2) tutMarkSeen();
}

function tutUpdate(dt) {
  if (!tutActive) return;
  tutTotal += dt; tutT += dt;
  /* 超时兜底：文档要求 30 秒内一定结束，玩家站着不动也不例外 */
  if (tutTotal >= TUT_LIMIT) { tutFinish(); return; }
  if (!player) { tutFinish(); return; }

  var moved = (player.c !== tutSpawnC || player.r !== tutSpawnR);
  var gained = player.seatCount - tutBaseSeats;

  if (tutStep === 0) {
    if (moved) { tutStep = 1; tutT = 0; }
  } else if (tutStep === 1) {
    if (gained >= 1) { tutStep = 2; tutT = 0; }
  } else if (tutStep === 2) {
    /* 占到 4 格说明已经上手了，不必等满 4.5 秒 */
    if (tutT >= TUT_STEP3_SEC || gained >= 4) tutFinish();
  }
}

/* 引导气泡：挂在玩家上方，跟着人走。
 * 画在相机变换之内 —— 局部放大开着时整块一起放大，不会出现「气泡比角色还小」。 */
/* 气泡的几何单独算出来，绘制与断言共用同一份。
 * ⚠️ 不让断言另写一套几何 —— 那样两边早晚会不一致，而「不一致的断言」
 *    比没有断言更糟：它会一直绿着，直到真出问题那天。
 *
 * 两条安全阀都在这里（绘制侧只管照着画）：
 *   横向：夹在教室左右边界内；
 *   纵向：上方放不下（玩家贴到第一排）就翻到玩家下方，再夹一次底边 ——
 *         保证气泡永远待在座位区里，绝不越过 WALL_T 顶进墙面带
 *         （那里有黑板和任务面板，顶进去就是 P0 级遮挡）。
 *
 * ⚠️ 字号给一个下限：紧凑版 TILE=28，S36(14) 只有 10.9px ——
 *    审阅报告刚批评过「手机端任务面板 8px 基本读不清」，引导不能再犯同一个错。
 *    行高与气泡高度都**由字号推导**，不写死高度 —— 否则字号一加下限，
 *    紧凑版的行距就被压没了。 */
function tutBubbleBox(g, actor, main, sub) {
  var fMain = Math.max(FS('hud'), 12.5), fSub = Math.max(FS('sub'), 9.5);
  var pad = Math.max(S36(13), 11), dotW = Math.max(S36(24), 20);
  var yMain = pad + fMain * 0.62;
  var ySub = yMain + (fMain + fSub) * 0.55 + S36(4);
  var h = ySub + fSub * 0.62 + pad * 0.8;

  g.font = font(fMain, 900);
  var wMain = g.measureText(main).width;
  g.font = font(fSub, 700);
  var wSub = g.measureText(sub).width;
  var w = Math.max(wMain, wSub) + pad * 2 + dotW;

  var hx = CX(actor.c), hy = TY(actor.r);
  var x = clamp(hx - w / 2, GX + S36(3), GX + COLS * TILE - w - S36(3));
  var y = hy - S36(20) - h;
  var below = false;
  if (y < GY + S36(3)) {
    y = Math.min(hy + S36(20), GY + ROWS * TILE - h - S36(3));
    below = true;
  }
  return { x: x, y: y, w: w, h: h, below: below, hx: hx, hy: hy,
    fMain: fMain, fSub: fSub, yMain: yMain, ySub: ySub, pad: pad, dotW: dotW };
}

function drawTutorial(g, time) {
  if (!tutActive || !player || state !== 'play') return;
  var step = TUT_STEPS[tutStep] || TUT_STEPS[0];
  var main = (isTouch && tutStep === 0) ? TUT_TOUCH_MAIN : step.text;
  var box = tutBubbleBox(g, player, main, step.sub);
  var x = box.x, y = box.y, w = box.w, h = box.h;

  g.save();

  /* 第一步额外给一圈脉动方框 —— 新手第一件要搞清的事就是「哪个是我」 */
  if (tutStep === 0) {
    var ph = 0.5 + 0.5 * Math.sin(time * 3.4);
    g.globalAlpha = 0.50 + 0.35 * ph;
    g.strokeStyle = '#E8B93C';
    g.lineWidth = S36(3);
    var ex = S36(4) + ph * S36(5);
    rr(g, TX(player.c) - ex, TY(player.r) - ex, TILE + ex * 2, TILE + ex * 2, S36(10));
    g.stroke();
    g.globalAlpha = 1;
  }

  /* 气泡本体。深色半透明底 + 金边：座位区底色有深有浅（米黄地板 / 木纹课桌），
     浅色卡片在浅色底上会糊，深色卡片两边都抠得出来。 */
  rr(g, x, y, w, h, S36(11));
  g.fillStyle = 'rgba(38,30,20,.90)';
  g.fill();
  g.strokeStyle = '#E8B93C';
  g.lineWidth = S36(2);
  g.stroke();

  /* 指向玩家的小三角 */
  var tx = clamp(box.hx, x + S36(14), x + w - S36(14));
  g.beginPath();
  if (box.below) {
    g.moveTo(tx - S36(7), y); g.lineTo(tx + S36(7), y); g.lineTo(tx, y - S36(8));
  } else {
    g.moveTo(tx - S36(7), y + h); g.lineTo(tx + S36(7), y + h); g.lineTo(tx, y + h + S36(8));
  }
  g.closePath();
  g.fillStyle = 'rgba(38,30,20,.90)';
  g.fill();
  g.strokeStyle = '#E8B93C';
  g.lineWidth = S36(2);
  g.stroke();

  /* 文字（左对齐，别居中 —— 居中时每一步的字宽不同，视觉上会左右跳） */
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = font(box.fMain, 900);
  g.fillStyle = '#FFFFFF';
  g.fillText(main, x + box.pad, y + box.yMain);
  g.font = font(box.fSub, 700);
  g.fillStyle = 'rgba(255,255,255,.62)';
  g.fillText(step.sub, x + box.pad, y + box.ySub);

  /* 三步进度点（竖排贴右边缘）。矢量圆点，不依赖 ①②③ 这类字符。 */
  var dx = x + w - box.pad - S36(4);
  var dy0 = y + h / 2 - S36(9);
  for (var i = 0; i < TUT_STEPS.length; i++) {
    g.beginPath();
    g.arc(dx, dy0 + i * S36(9), S36(i === tutStep ? 3.6 : 2.4), 0, 6.2832);
    g.fillStyle = (i === tutStep) ? '#E8B93C' : 'rgba(255,255,255,.34)';
    g.fill();
  }

  g.restore();
}


/* ==========================================================
 * 9. 移动
 * ========================================================== */

/* 这一格还有没有活路。
 * owner：这一格属于谁 —— **自己的占座一律算通路**。
 *
 * V1.6（文档第三章）：原来只有摸鱼大师开了「老师来了」时才把自己的路线算通路，
 * 现在**所有玩家**的自己的占座都算通路，不再依赖任何技能。
 * 于是「被自己的路线围死」从根本上不成立 —— 这正是手册要的
 * 「降低自撞带来的操作负担」。
 * 不传 owner 时行为与 V1 逐字一致（NPC 的 blocked 判定走的就是这条路）。 */
function hasFreeNeighbor(c, r, owner) {
  for (var i = 0; i < 4; i++) {
    var nc = c + DIRS[i].dx, nr = r + DIRS[i].dy;
    if (!inB(nc, nr)) continue;
    var t = grid[I(nc, nr)];
    if (!t.owner) return true;
    if (owner && t.owner === owner) return true;
  }
  return false;
}

/* 走一步。判定顺序**固定**为「自己的座位 → 对手身体 → 别人的座位」，
 * 保证同一种碰撞不论从哪个入口进来都得到同一个结果
 * （见 V1.6收敛/规则核对表.md 第 4 节）。
 *
 * noPenalty：只给「同帧争抢的输家」用 —— 他按下方向键时那格还是空的，
 * 不该为「同时性」挨罚。老调用点不传 → 与 V1 逐字同路径。 */
function tryMovePlayer(d, actor, noPenalty) {
  if (!actor.alive) return;
  /* V1.6：复位等待中不接受任何移动输入 */
  if (actor.penalty > 0) return;

  var nc = actor.c + d.dx, nr = actor.r + d.dy;

  actor.dir = d;

  if (!inB(nc, nr)) {
    if (bumpT <= 0) { Sound.bump(); bumpT = 0.25; }
    return;
  }

  var t = grid[I(nc, nr)];

  /* ① 自己的占座 = 安全通行区（V1.6 核心改动）。
   *    走进去不重新占座、不计分、不加占座数、不触发也不延续 Combo、
   *    不刷任务进度、不播放占座音效、不重复生成占座物 —— 只是走过去。
   *    这一段刻意**不调用 claimTile**，上面那些副作用就全部不会发生。 */
  if (t.owner === actor.id) {
    actor.c = nc;
    actor.r = nr;
    actor.bob = 1;
    return;
  }

  /* ② 对手身体所在格 = 挡路，但不处罚。
   *    与「撞墙」同类：对手身体不是占座路线。做成不处罚，
   *    是为了不留「贴脸堵人、逼对方挨罚」的骚扰空间。
   *    复位等待中的玩家不在场上，身体不挡路。 */
  for (var hi = 0; hi < humans.length; hi++) {
    var hu = humans[hi];
    if (hu !== actor && hu.alive && hu.penalty <= 0 && hu.c === nc && hu.r === nr) return;
  }

  if (t.owner) {
    /* ③ 摸鱼大师「借道」：短时间穿过**他人**的占座区域。
     *    经过时不抢夺、不计分、不改变所有权（文档第七章）。 */
    if (actor.ghost > 0) {
      actor.c = nc;
      actor.r = nr;
      actor.bob = 1;
      return;
    }
    if (isVersus()) {
      /* ④ 双人：走进对手 / NPC 的占座 = 惩罚性碰撞。
       *    主动撞上去、被围住、同帧争抢失败 —— 三种入口到这里汇成同一结果。
       *    顺手给占住这格的人记一次「封锁」。 */
      var blocker = actorById(t.owner);
      if (blocker) blocker.blockCount++;
      if (!noPenalty) penalizePlayer(actor);
      return;
    }
    /* ⑤ 单人（D，2026-10-04）：撞到 NPC 的占座路线**也走惩罚性碰撞**，
     *    与双人完全同一套（扣分 + 连击清零 + 约 2 秒后回安全走道，计时不暂停）。
     *    开关关掉时逐字回到 V1 的「直接出局」。
     *    ⚠️ `noPenalty` 是「同帧争抢的输家」专用豁免，单人不存在这种情形，
     *       所以这里**不**接它 —— 否则会出现「既不罚也不出局」的第三种结果。 */
    if (!SOLO_PENALTY_ON) { endGame('npc'); return; }
    penalizePlayer(actor);
    return;
  }

  /* 抢座前先判断这格是不是“正在被抢”的特殊座位 */
  if (!t.aisle && t.type !== 'normal' && isContested(nc, nr, actor)) t.contest = true;

  actor.c = nc;
  actor.r = nr;
  actor.bob = 1;

  /* 走道不占座，只有座位才归你 */
  if (!t.aisle) claimTile(nc, nr, actor);

  if (!hasFreeNeighbor(nc, nr, actor.id)) {
    /* ⑥ 被围困：统一走 `stuckOutcome`（D 之后单人也复位，不再出局）。 */
    stuckOutcome(actor);
  }
}

/* ==========================================================
 * 9b. 惩罚性碰撞与复位（V1.6 第三 / 第四阶段）
 * ----------------------------------------------------------
 * 文档要求：双人里发生惩罚性碰撞时**不结束整局**，统一执行
 *   扣 50 分（最低 0）→ 连击清零 → 约 2 秒复位 → 从本方起始走道重新出现，
 * 对方与计时继续运行。
 *
 * 三条硬规矩：
 *   1. 全程零 Math.random —— 粒子特效走独立的 penRand（见下方注释）；
 *   2. 复位点是**确定性搜索**出来的安全走道格，不用随机；
 *   3. 访客端不执行这套逻辑：房主算完经快照同步（netSendSnapshot 带 pen 字段）。
 * ========================================================== */
var PENALTY_SCORE = 50;    /* 惩罚性碰撞扣分（文档：扣 50 分，最低不低于 0） */
var PENALTY_WAIT = 2.0;    /* 复位等待秒数（文档：约 2 秒） */
var PENALTY_INVULN = 0.8;  /* 复位落地后的保护秒数，防止连续受罚 */

/* 惩罚特效专用随机流。
 * ⚠️ addParticles 默认借 Math.random，而 Math.random 决定整局 NPC 走位 ——
 * 在局中新增任何一次 Math.random 调用都会把整局随机序列重排（铁律一）。
 * 所以这里自带一条**固定种子**的独立流：特效每局长得一样、完全可复现，
 * 且一个字节都不碰主随机流。 */
var penSeed = 20260928;
function penRand() {
  penSeed = (penSeed * 1664525 + 1013904223) >>> 0;
  return penSeed / 4294967296;
}
function penReset() { penSeed = 20260928; }

/* 惩罚性碰撞：**唯一入口**。所有「走不进去」的情形都收敛到这里。 */
function penalizePlayer(actor) {
  if (!actor || !actor.alive) return;
  if (actor.penalty > 0) return;   /* 已经在复位中，不叠加 */
  if (actor.invuln > 0) return;    /* 保护期内不重复受罚 */
  actor.penalty = PENALTY_WAIT;
  actor.score = Math.max(0, actor.score - PENALTY_SCORE);
  actor.combo = 0;
  actor.penaltyCount++;
  /* 第四阶段：反馈要「短、明确、可继续」—— 飘字 + 轻震 + 短音，
     不做冗长死亡动画。 */
  addFloat(CX(actor.c), CY(actor.r) - 40, '失误！ -' + PENALTY_SCORE,
    DANGER_STYLE.text, FS('fL'), 1.5);
  shake(9, 0.32);
  Sound.crash();
  addParticles(CX(actor.c), CY(actor.r), 16, ['#FF8A5B', '#FFD84D', '#FFFFFF'], 1.1, penRand);
}

/* 「被围死」的统一出口（三个调用点共用）。
 * D（2026-10-04）之后单人也不再出局 —— 与双人走同一套惩罚复位，
 * 这样「失误有损失，但还有追回来的机会」在两种模式下是同一条规则。
 * 开关关掉时单人逐字回到 V1 的 `endGame('blocked')`。 */
function stuckOutcome(actor) {
  if (isVersus() || SOLO_PENALTY_ON) { penalizePlayer(actor); return; }
  endGame('blocked', actor);
}

/* 复位点：在本方起始走道附近找最近的**安全**走道格。
 * 安全 = 不与另一名玩家重合 + 落地后四邻还有活路（否则会连续受罚）。
 * 纯确定性扫描（固定顺序 + 曼哈顿距离 + 平手取小下标），零随机消耗。 */
function findSafeRespawn(actor) {
  var idx = humans.indexOf(actor);
  var home = humanHome(MODE, idx < 0 ? 0 : idx);
  var best = null, bestD = 1e9;
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      if (!grid[I(c, r)].aisle) continue;
      var busy = false;
      for (var hi = 0; hi < humans.length; hi++) {
        var o = humans[hi];
        if (o === actor || !o.alive) continue;
        if (o.c === c && o.r === r) { busy = true; break; }
      }
      if (busy) continue;
      /* 落地后必须还有活路：自己的座位也算通路，所以这条很容易满足 */
      if (!hasFreeNeighbor(c, r, actor.id)) continue;
      var d = Math.abs(c - home[0]) + Math.abs(r - home[1]);
      if (d < bestD) { bestD = d; best = { c: c, r: r }; }
    }
  }
  return best || { c: actor.c, r: actor.r };
}

function respawnPlayer(actor) {
  var spot = findSafeRespawn(actor);
  actor.c = spot.c;
  actor.r = spot.r;
  actor.dir = DIRS[0];
  actor.bob = 1;
  actor.stepTimer = 0;
  actor.claimFlash = 1;
  actor.invuln = PENALTY_INVULN;
  addFloat(CX(actor.c), CY(actor.r) - 40, '重新出发！', '#0B6B62', FS('fM'), 1.2);
}

/* ---------- 技能 ---------- */

/* ---------- 联机流程 ---------- */

function inviteUrl(room) {
  try {
    var u = window.location.href.split('#')[0].split('?')[0];
    /* R3.5：纯真人现在是**默认**，所以默认不往链接里塞参数；
       只有房主显式关掉（`?purepvp=0`）时才把「要 NPC」这件事带给访客 ——
       否则访客那边仍会按默认值不建 NPC，与房主看到的不是同一局。 */
    var extra = PURE_PVP_TEST_MODE ? '' : '&purepvp=0';
    return u + '?room=' + encodeURIComponent(room) + extra;
  } catch (e) { return '?room=' + room; }
}

function netMarkSelf() {
  var t1 = document.getElementById('ptag-1');
  var t2 = document.getElementById('ptag-2');
  var me = netSelfId();
  if (t1) t1.innerHTML = '1P' + (me === 'player' && isNet() ? '<span class="you">你</span>' : '');
  if (t2) t2.innerHTML = '2P' + (me === 'p2' && isNet() ? '<span class="you">你</span>' : '');
}

/* 访客发技能请求（房主权威，技能也得由房主执行）。
 * V1.6 第二阶段：每个角色只有一个技能槽，第二槽的请求不再发出 ——
 * 拦在这里而不是靠对面兜底，是为了让线上协议本身也只剩一个槽。 */
function netRequestSkill(slot) {
  if (!isGuest() || !Net.connected()) return;
  if ((slot | 0) !== 0) return;
  Net.send({ t: 'k', s: 0 });
}

/* 房主：好友连进来了 */
function onGuestJoined() {
  NET.conn = true;
  netStatus('好友已加入，开始！');
  beginCountdown();
}

function onNetMessage(m) {
  if (!m || !m.t) return;
  if (m.t === 'i') { netApplyGuestInput(m); return; }
  if (m.t === 'k') {
    /* V1.6 第二阶段：协议里只剩槽位 0。`(m.s | 0) === 0` 同时挡掉 undefined
       （老客户端不带 s 时按 0 处理）和任何越界的槽位号。 */
    if (isHost() && humans.length > 1 && (m.s | 0) === 0) useSkill(humans[1], 0);
    return;
  }
  if (m.t === 's') { netApplySnapshot(m); return; }
  if (m.t === 'c') {
    var t = grid[m.i];
    if (!t) return;
    t.owner = m.o; t.item = m.it || ''; t.anim = 1; t.claimAge = 0;
    /* 阶段 8 追加 R3：室友替占的记号跟着同步（老房主不带 h → 按 0 处理）。
       阶段 8 追加 R3.2：值从 1 改成 2（与 claimTile 同一口径）。
       ⚠️ 这里**不要**改成 `m.h === 2 ? 2 : 1` —— 访客端只认「是不是室友拿的」，
          不认值本身，写死 2 才能让新旧房主都落到同一个语义上。 */
    t.hm = m.h ? 2 : 0;
    t.hmh = m.w ? 1 : 0;
    return;
  }
  if (m.t === 'o') { netApplyResult(m); return; }
}

function netApplyResult(m) {
  state = 'over';
  if (humans[0] && m.a && m.a[0]) {
    var a0 = m.a[0];
    humans[0].seatCount = a0.st; humans[0].score = a0.sc; humans[0].maxCombo = a0.mc;
    humans[0].blockCount = a0.bk; humans[0].winCount = a0.wn;
    /* 第三阶段：结算新增两行，访客端也要拿到真实值（老房主不带这两个字段 → 落 0） */
    humans[0].specialCount = a0.sp || 0; humans[0].penaltyCount = a0.pc || 0;
  }
  if (humans[1] && m.a && m.a[1]) {
    var a1 = m.a[1];
    humans[1].seatCount = a1.st; humans[1].score = a1.sc; humans[1].maxCombo = a1.mc;
    humans[1].blockCount = a1.bk; humans[1].winCount = a1.wn;
    humans[1].specialCount = a1.sp || 0; humans[1].penaltyCount = a1.pc || 0;
  }
  elOverReason.textContent = m.reason || '本局结束';
  fillVersusReportByIdx(m.win);
  elOverSolo.classList.add('hidden');
  elOverVs.classList.remove('hidden');
  elOver.classList.add('vs');
  elHud.classList.add('hidden');
  showOverScreen();
}

/* 用「下标」而不是 Actor 对象来填对战报告（访客端也要用） */
function fillVersusReportByIdx(winIdx) {
  elVsTitle.textContent = winIdx < 0 ? '平局！' : ((winIdx === 0 ? '1P' : '2P') + ' 抢赢了！');
  for (var n = 1; n <= 2; n++) {
    var a = humans[n - 1];
    if (!a) continue;
    $('vs-seats-' + n).textContent = String(a.seatCount);
    /* V1.6 第三阶段（手册 §十二）：双人结算要能解释「为什么谁赢」，
       所以补上「特殊座位」与「碰撞次数」两行 —— 这两个计数 V1 就有，不用新加。
       ⚠️ 故意**没有「任务奖励」那一行**：双人模式根本没有任务系统
       （updateTasks() 在 isVersus() 时第一行就 return），
       加一行恒为 0 的统计比不显示更像坏了。手册那句是「建议展示」。 */
    $('vs-special-' + n).textContent = String(a.specialCount || 0);
    $('vs-score-' + n).textContent = String(a.score);
    $('vs-pen-' + n).textContent = String(a.penaltyCount || 0);
    $('vs-combo-' + n).textContent = String(a.maxCombo);
    $('vs-block-' + n).textContent = String(a.blockCount);
    $('vs-win-' + n).textContent = String(a.winCount);
    var col = $('vs-col-' + n);
    if (col && col.classList) col.classList.toggle('win', winIdx === n - 1);
  }
  /* ⚠️ pick(VS_EVALS) 会消耗一次 Math.random —— 它必须留在原地、只调用一次。
     上面新增的两行只是读字段写 DOM，不碰随机流，所以整局的随机序列不变。 */
  elVsEval.textContent = '“' + st(pick(VS_EVALS)) + '”';
}

function startOnlineHost() {
  if (typeof Net === 'undefined' || typeof Peer === 'undefined') {
    netStatus('联机组件没加载出来，请刷新页面重试');
    var st0 = $('net-status'); if (st0 && st0.classList) st0.classList.add('err');
    return;
  }
  MODE = 'versus';
  NET.role = 'host';
  NET.selfId = 'player';
  NET.room = Net.newRoom();
  if (stage.classList) stage.classList.add('net-host');
  netMarkSelf();

  var codeEl = document.getElementById('invite-code');
  var linkEl = document.getElementById('invite-link');
  if (codeEl) codeEl.textContent = NET.room;
  if (linkEl) linkEl.textContent = inviteUrl(NET.room);
  netStatus('正在创建房间…');

  Net.host(NET.room, {
    ready: function () { netStatus('房间已就绪，把房间号或链接发给好友'); },
    open: onGuestJoined,
    message: onNetMessage,
    close: function () { NET.conn = false; netStatus('好友断开了连接'); },
    error: function (e) {
      var st = $('net-status'); if (st && st.classList) st.classList.add('err');
      netStatus('连不上信令服务（' + ((e && e.type) || '未知') + '），可以改用「本机双人」');
    }
  });
}

function joinOnlineGuest(room) {
  if (typeof Net === 'undefined' || typeof Peer === 'undefined') {
    netStatus('联机组件没加载出来，请刷新页面重试');
    return;
  }
  MODE = 'versus';
  NET.role = 'guest';
  NET.selfId = 'p2';
  NET.room = room;
  if (stage.classList) stage.classList.add('net-guest');
  netMarkSelf();

  var area = document.getElementById('invite-area');
  if (area && area.classList) area.classList.remove('hidden');
  var codeEl = document.getElementById('invite-code');
  if (codeEl) codeEl.textContent = room;
  var linkEl = document.getElementById('invite-link');
  if (linkEl) linkEl.textContent = '你是访客（2P），等房主开始';
  netStatus('正在连接房间 ' + room + ' …');

  Net.join(room, {
    open: function () { NET.conn = true; netStatus('已连接，等房主开始'); },
    message: onNetMessage,
    close: function () { NET.conn = false; netStatus('连接已断开'); },
    error: function (e) {
      var st = $('net-status'); if (st && st.classList) st.classList.add('err');
      netStatus('加入失败（' + ((e && e.type) || '未知') + '），确认房间号是否正确');
    }
  });
}

/* 奶茶诱惑：附近 NPC 停下抢座 */
function skillMilk(a) {
  var hit = 0;
  for (var i = 0; i < npcs.length; i++) {
    var n = npcs[i];
    if (Math.abs(n.c - a.c) + Math.abs(n.r - a.r) <= 8) { n.freeze = SKILLS.milk.dur; hit++; }
  }
  return hit;
}

/* 点名危机：单人时没有对手，就改成让同学们一起慢下来 */
function skillCallout(a) {
  var hit = 0;
  for (var i = 0; i < humans.length; i++) {
    if (humans[i] === a) continue;
    humans[i].slow = SKILLS.callout.dur;
    hit++;
  }
  if (!hit) {
    for (i = 0; i < npcs.length; i++) { npcs[i].slow = SKILLS.callout.dur; hit++; }
  }
  return hit;
}

/* 共享单车：沿当前朝向一口气溜 4 格，遇阻就停。
 *
 * V1.6 第一阶段：口径与 tryMovePlayer 对齐 ——
 *   ① 自己的占座算通路，冲刺不会被自己刚占下的格子截停；
 *   ② 只有「别人的座位」才算遇阻；
 *   ③ 溜完站在死角里，双人走惩罚（复位），单人照 V1 出局。
 * 注意 t.owner 为真时不再 claimTile —— 穿过自己的座位不能重复占座、不能重复计分。 */
function skillBike(a) {
  var d = a.dir, moved = 0;
  for (var i = 0; i < 4; i++) {
    var nc = a.c + d.dx, nr = a.r + d.dy;
    if (!inB(nc, nr)) break;
    var t = grid[I(nc, nr)];
    if (t.owner && t.owner !== a.id) break;
    a.c = nc; a.r = nr;
    if (!t.aisle && !t.owner) claimTile(nc, nr, a);
    addParticles(CX(nc), CY(nr), 6, ['#7FD1FF', '#FFFFFF'], 0.5);
    moved++;
  }
  if (moved && !hasFreeNeighbor(a.c, a.r, a.id)) {
    /* D（2026-10-04）：技能位移把自己送进死角 —— 单人也走惩罚复位，不再出局。 */
    stuckOutcome(a);
  }
  return moved;
}

/* ==========================================================
 * 7d. 室友（社交达人「求助室友」召唤的小跟班）
 * ----------------------------------------------------------
 * 手册第四阶段对社交达人的要求是「召唤 NPC 帮助占座」，优势「完成连座任务」。
 * 做成一个只会做一件事的跟班：**在玩家的占座路线旁边找空位，占下来记在玩家头上**。
 * 于是玩家用一次技能就多出一截连座，《室友拜托》这类任务好做得多。
 *
 * 硬规矩和事件 / 任务系统一样：**整节不许出现 Math.random()**。
 * 找目标、挪步子全部走确定性规则（固定扫描顺序 + 曼哈顿距离 + 平手取小下标），
 * 所以「加了室友」不会把整局 NPC 走位带偏。
 *
 * 室友不进 actors / npcs —— 它没有 AI 人格、不参与抢座判定，
 * 单独一个数组最省事，也绝不会污染 V1 那套 Actor 循环。
 * ========================================================== */
var helpers = [];
var HELPER_STEP_MS = 420;      /* 比玩家慢一档：不至于一瞬间铺满一排 */

/* ===== V36 下一阶段 · 阶段 7：室友「按玩家朝向帮占」 =====
 * 文档原文：「室友不随机乱跑，优先沿玩家当前面向方向占附近空位，
 *   让玩家主动决定扩张方向。」
 *
 * 改前：只按「离室友最近」挑，玩家朝哪边都一样 —— 扩张方向由室友的站位决定。
 * 改后：**朝向是第一优先级**（玩家面向的那半平面），同半平面里先看「离玩家多近」，
 *   再看「离室友多近」，最后才按格子下标打破平手。
 * 关掉开关 → 三条优先级退化成原来那一条（face 恒为 0、dPl 恒为 0）→ 逐字回到改前。 */
var ROOMIE_FACING_ON = true;

/* ===== 阶段 8 修（2026-10-20 用户试玩反馈 R2）=====
 * 反馈原话：「室友的路线设置应该聚焦于目前没有占的座位，不要拘泥在一小块转」。
 *
 * 改前：候选格按 face（玩家前方）→ dPl（离玩家近）→ d（离室友近）排。
 *   `dPl` 是第二优先级，而玩家站着不动时它几乎恒定 —— 于是室友永远在
 *   玩家身边那一小圈里挑，看起来就是「围着一小块打转」。
 * 改后：在 face 之后插一档 **open（这一格四周还有几个空座）**，
 *   优先挑「更靠外、四周更空」的格子 —— 它就会顺着玩家地盘的外缘往外铺，
 *   而不是贴着玩家原地绕圈。face 仍然是第一优先级，文档要求的「按朝向扩张」不变。
 * 关掉 → open 恒为 0，三条比较逐字退回改前那一套。 */
var ROOMIE_OPEN_ON = true;

/* ===== 阶段 8 追加（2026-10-21 用户试玩反馈 R2 续）=====
 * 反馈原话：「适当增加舍友帮忙时间，如 5 到 10 秒，且舍友一出来，就触发他消失的倒计时」。
 *
 * ⚠️ 先量了再改：`SKILLS.help.dur` 写的是 12 秒，但**实际在场只有 2.18 秒**
 *   （`_tmp_life.js` 实测：替占时刻 0.45 / 1.32 / 2.18 秒，然后 `left` 归零自己走人）。
 *   所以「帮忙时间短」的真根因不是 dur，而是 **`left = 3`（最多替占 3 格）先绑死了**。
 *   同理，倒计时只在 `t <= 3` 才画，而 t 从 12 掉到 9.8 它就走了
 *   → **那个倒计时一次都没机会出现**，用户说「一出来就触发倒计时」正是这个原因。
 *
 * 改法：把「时长」变成真正生效的那一档。
 *   `ROOMIE_HELP_DUR = 10` 秒（用户 2026-10-21 晚追加：「把舍友帮忙时间延伸到 10 秒钟」），
 *   `ROOMIE_HELP_SEATS = 26` 格（比 10 秒能走的步数多，保证是**时间**先到而不是格数先到
 *   —— 这样头顶的秒数才是真话，不会「还剩 4 秒却突然消失」）。
 *   ⚠️ 26 这个数不是拍的：1 拍 = HELPER_STEP_MS = 420ms，10 秒最多走 23.8 拍，
 *      取 26 = 「够不着的上限」，留 2 拍余量防浮点/掉帧把它变成「格数先到」。
 * 关掉 → `t` 回到 `SKILLS.help.dur`、`left` 回到 3 → 逐字退回阶段 8 行为。 */
var ROOMIE_LONGER_ON = true;
var ROOMIE_HELP_DUR = 10;     /* 秒：室友在场时长 */
var ROOMIE_HELP_SEATS = 26;   /* 格：最多替占（要大于 10 秒能走的 23.8 拍，让时间先到） */
/* 「找不到目标」时宽限几拍再走人（1 拍 = HELPER_STEP_MS = 420ms，5 拍 ≈ 2.1 秒）。
 * 不设这个的话，玩家站在走道十字口召唤室友 → 四邻全是 aisle → 当拍消失。 */
var ROOMIE_HELP_GRACE = 5;

/* 消失倒计时：`true` = 从出生就显示「剩 N 秒」；`false` = 退回「最后 3 秒才画数字」。 */
var ROOMIE_TIMER_ON = true;

/* ===== 阶段 8 追加 R3（2026-10-21 晚 用户试玩反馈）=====
 * 反馈原话：「舍友帮忙的时候还存在着舍友占的座没有记号的问题」。
 *
 * 改前只有 `helperMarks` 那 0.6 秒的**扩散环** —— 环一散，室友替占的格子和
 * 玩家自己按出来的格子长得一模一样（`t.owner` 都是玩家 id，配色、光晕、
 * 路线光带全都一样）。玩家事后根本分不清「哪几格是室友帮我拿的」。
 *
 * 改法：在格子上留一个**长期**记号（`t.hm` 标记 + `drawHelperClaimMarks` 绘制）：
 *   ① 青绿虚线内环 —— 虚线读作「别人帮你拿的」，和玩家自己的橙色**实心**光晕分开；
 *   ② 右下角小旗（青绿圆角块 + 🙋）—— 一眼定位，不靠颜色记忆。
 *      R3.1 从右上角挪到右下角（右上角被清理预告的倒计时数字占了）；
 *      R3.2 起「刚经过的 0.6 秒」换成浅青绿底。
 * `t.hm` 是纯数据，指纹只读 owner/type/item（见 `指纹回归.js` 的 gridSig），
 * 所以这个字段**不会**改变任何一档指纹读数；开关关掉 → 一笔都不画。 */
var ROOMIE_MARK_ON = true;

/* ===== 阶段 8 追加 R3.2（2026-10-22 用户试玩定调）=====
 * 反馈原话：「只要是舍友经过座位那个座位就被占了 不用再延迟什么的 只要经过就标记占位」。
 *
 * 改前：室友只占**它当前站着的那一格**（`tc === h.c && tr === h.r` 那条），
 *   也就是每 420ms 走一格、到了才占一格。路径中间那些格子**什么都没有** ——
 *   用户看到的「室友经过座位却没标记」，字面上就是这个：经过 ≠ 占下。
 *
 * 改后：**踩上去就占、路过就占**。
 *   ① `claimTile(..., true)` 的调用点从「到位那一拍」挪到「挪进去的那一步」——
 *      室友脚落到哪一格，那一格当场就是你的（旧的到位分支留着当兜底，不再触发）。
 *   ② 每一步**顺带**把「沿它这一步的方向、左右各一格」也占下来（`helperWalkClaim`）——
 *      一排放 3 座正好围住它要走的过道，这就是「经过座位就被占了」。
 *      ⚠️ 只扫**这一拍的 4 邻接**（≤4 格），不是整张图：扫全图会让每一拍的成本
 *         从 O(1) 变成 O(810)，而且「经过」本来就只可能是挨着走的那几格。
 *   ③ 只占 `!aisle && !owner` —— 走道不占、别人的座位不抢（抢座规则不改）。
 *   ④ 占下来的每一格都带 `t.hm = 2` → 记号与「室友站定占的那格」完全一样。
 *
 * 代价（已量过，见 `阶段8追加_报告_2026-10-21.md` §11）：
 *   `left`（最多替占几格）会消耗得更快 —— 10 秒在场、每拍最多 3 格，
 *   所以 `left` 一直都不是瓶颈；`t`（时长）仍然是先到的那一档。
 *   关掉这个开关 → 只回到「到哪格占哪格」，逐字退回阶段 8 行为。
 *   ⚠️ 本开关**不进 `v16SetV15()` 收敛组**（那 28 个是「V1.5 原本没有的功能」，
 *      室友整套都是阶段 7 之后才有的，本来就不在组里）。 */
var ROOMIE_WALK_ON = true;
/* 经过高亮的寿命（秒）。纯表现层，不进 grid。 */
var ROOMIE_WALK_FLASH = 0.6;

/* 室友刚占下的格子：{c,r,t}，只用来画 0.6 秒的扩散环。
 * **纯表现层**，不进 grid、不进 actors，所以 core/grid 指纹一格不动。 */
var helperMarks = [];

function helperReset() { helpers = []; helperMarks = []; helperWalkFreshReset(); }

/* 室友头顶的消失倒计时。**唯一判据**，绘制与探针都走这里（铁律 13：别在探针里另写一套）。
 * 返回 `{n, urg}`：`n` = 剩余整秒（向上取整，最小 1），`urg` = 最后 1.2 秒（画成红色并跳动）。
 * `ROOMIE_TIMER_ON` 关掉时恒返回 null → 绘制退回「最后 3 秒才画数字」的老分支。 */
function helperCountdown(h) {
  if (!ROOMIE_TIMER_ON || !h || h.t <= 0) return null;
  return { n: Math.max(1, Math.ceil(h.t)), urg: h.t <= 1.2 };
}

function sgn(v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); }

/* 找「能接上玩家路线、还空着」的座位里，离 (c,r) 最近的一个。
 * 「能接上」= 4 邻接玩家已有的座位，**或者** 4 邻接玩家本人 ——
 * 后者是必需的：开局玩家一个座位都没有，只认「贴着已有座位」会永远找不到目标。
 *
 * 两个安全阀，都是为了别把玩家自己堵死：
 *   1. 先「试占一下」再判断玩家还有没有活路，没有就换下一个候选（不掷骰子，纯试算）
 *   2. 平手取下标小的，保证同一局面每次选到同一格 —— 整节零 Math.random() */
/* 这一格四周还有几个「空着的座位」。越大 = 越靠外、越值得往那边铺。
 * 只数 4 邻接、只读 grid，不掷骰子。 */
function helperOpenScore(ci, ri) {
  var n = 0;
  for (var k = 0; k < 4; k++) {
    var nc = ci + DIRS[k].dx, nr = ri + DIRS[k].dy;
    if (!inB(nc, nr)) continue;
    var t = grid[I(nc, nr)];
    if (!t.aisle && !t.owner) n++;
  }
  return n;
}

function helperTarget(c, r, owner) {
  var pl = actorById(owner);
  var best = -1, bestD = 1e9, bestFace = 2, bestDPl = 1e9, bestOpen = -1;
  /* 阶段 7：朝向优先。关掉开关时 useFace = false → face 恒 0、dPl 恒 0，
     三条比较退化成原来那一条（d < bestD），与改前逐字等价。 */
  var useFace = ROOMIE_FACING_ON && pl && pl.dir;
  for (var i = 0; i < grid.length; i++) {
    var t = grid[i];
    if (t.aisle || t.owner) continue;
    var ci = i % COLS, ri = (i / COLS) | 0;

    var touch = false;
    for (var k = 0; k < 4; k++) {
      var nc = ci + DIRS[k].dx, nr = ri + DIRS[k].dy;
      if (!inB(nc, nr)) continue;
      if (grid[I(nc, nr)].owner === owner) { touch = true; break; }
      if (pl && nc === pl.c && nr === pl.r) { touch = true; break; }
    }
    if (!touch) continue;

    /* 试占一下看会不会把玩家围死；无论如何都把 owner 还原。
     * V1.6 第一阶段起 hasFreeNeighbor 统一收自己的 id —— 自己的座位是通路，
     * 所以室友占的座位永远不会把主人围死（原来还要看 ghost 是否生效，口径已经不需要了）。 */
    if (pl && pl.alive) {
      t.owner = owner;
      var safe = hasFreeNeighbor(pl.c, pl.r, pl.id);
      t.owner = null;
      if (!safe) continue;
    }

    /* ① 是不是在玩家面向的那半平面里（点积 > 0 = 前方） */
    var face = 0, dPl = 0;
    if (useFace) {
      var vc = ci - pl.c, vr = ri - pl.r;
      face = (vc * pl.dir.dx + vr * pl.dir.dy > 0) ? 0 : 1;
      dPl = Math.abs(vc) + Math.abs(vr);
    }
    /* ② 四周还有多空（阶段 8 修：让室友往外铺，别贴着玩家绕圈）。
       关掉开关时恒为 0 —— 下面那条链逐字退回改前。 */
    var open = ROOMIE_OPEN_ON ? helperOpenScore(ci, ri) : 0;
    var d = Math.abs(ci - c) + Math.abs(ri - r);
    if (face < bestFace ||
        (face === bestFace && open > bestOpen) ||
        (face === bestFace && open === bestOpen && dPl < bestDPl) ||
        (face === bestFace && open === bestOpen && dPl === bestDPl && d < bestD)) {
      bestFace = face; bestOpen = open; bestDPl = dPl; bestD = d; best = i;
    }
  }
  return best;
}

/* 召唤。入场点：玩家附近 1~2 圈里第一个没被占的格子，按固定顺序扫 —— 不掷骰子。 */
function skillHelp(a) {
  var spot = null, ring, dr, dc, c, r;
  for (ring = 1; ring <= 2 && !spot; ring++) {
    for (dr = -ring; dr <= ring && !spot; dr++) {
      for (dc = -ring; dc <= ring && !spot; dc++) {
        if (Math.abs(dr) !== ring && Math.abs(dc) !== ring) continue;
        c = a.c + dc; r = a.r + dr;
        if (!inB(c, r) || grid[I(c, r)].owner) continue;
        spot = { c: c, r: r };
      }
    }
  }
  if (!spot) return 0;

  helpers.push({
    c: spot.c, r: spot.r, owner: a.id,
    t: ROOMIE_LONGER_ON ? ROOMIE_HELP_DUR : SKILLS.help.dur,
    /* 出生时的总时长 —— 只给倒计时的淡入用（不能直接读 ROOMIE_HELP_DUR：
     * 开关关掉时它是 7，而实际时长是 SKILLS.help.dur=12，淡入系数会算成负数）。 */
    t0: ROOMIE_LONGER_ON ? ROOMIE_HELP_DUR : SKILLS.help.dur,
    step: 0, bob: 0, dir: DIRS[3],
    /* 最多替玩家占几格。改前恒为 3（「配上玩家自己那格正好凑 4 连座」）——
     * 但 3 格只用 2.18 秒就占完了，室友随即消失，用户感知的「帮忙时间」就是 2 秒。
     * 阶段 8 追加：`ROOMIE_LONGER_ON` 时提到 8 格，让它撑满 7 秒的时长。 */
    left: ROOMIE_LONGER_ON ? ROOMIE_HELP_SEATS : 3,
    /* 真的替玩家占了几格。**只做记账**，不参与任何判断。
     * 为什么要它：`left` 归零有两个来源 —— ①占满 ②找不到目标（下面 `ti < 0` 那条）。
     * 探针用 `left` 反推「占了几格」时这两种会串味（2026-10-21 实测：
     * 室友一出生就 `ti < 0` 走人，`left` 直接 0，却会被读成「占满了」）。 */
    got: 0,
    claim: 0, bubble: 2.2, stall: 0,
    /* 阶段 8：当前认准的目标格下标（-1 = 还没选）。
       见 updateHelpers 里的「认准就一直走」—— 不加这个，玩家一边跑一边占座时，
       室友每 420ms 换一次目标、永远追不上，看起来就是在原地打转。 */
    tc: -1
  });
  return 1;
}

/* 每帧驱动。和 updateTasks 一样不消耗 Math.random()，插在 update 里任何位置都安全。 */
/* ===== 阶段 8 追加 R3.2：「刚经过」高亮的衰减 =====
 * `t.hmh` 只有两种状态（1 = 刚经过 / 0 = 已站定），没有倒计时字段 ——
 * 每帧的算法极简：
 *   ① 先看 `walkFresh` 这个候选名单里，哪些格子已经到期（`walkFreshT` 归零）
 *      或者不再属于玩家 → 把 `t.hmh` 抹回 0；
 *   ② 再让剩下的候选 `walkFreshT -= dt`；到期的从名单里摘掉（**必须摘**，否则名单只增不减）；
 *   ③ 名单本身在同一帧里由 helperWalkClaim 重新 push。
 * 复杂度：O(候选格数)，候选是「最近 0.6 秒被走出来的格子」，最多几十个。
 * ⚠️ 绝不能改成「遍历全图扫 hmh」：810 格每帧一次，和铁律「帧开销落到噪声里」冲突。 */
var walkFresh = [];
var walkFreshT = [];

function helperWalkFreshReset() { walkFresh = []; walkFreshT = []; }

function helperWalkFlush() {
  for (var k = 0; k < walkFresh.length; k++) {
    var t = grid[walkFresh[k]];
    if (walkFreshT[k] <= 0 || !t.owner) t.hmh = 0;
  }
  walkFresh = [];
  walkFreshT = [];
}

function updateWalkFlash(dt) {
  var keepI = [], keepT = [];
  for (var k = 0; k < walkFresh.length; k++) {
    var i = walkFresh[k], left = walkFreshT[k] - dt;
    var t = grid[i];
    if (left <= 0 || !t.owner) { t.hmh = 0; continue; }
    keepI.push(i); keepT.push(left);
  }
  walkFresh = keepI;
  walkFreshT = keepT;
}

/* ===== 阶段 8 追加 R3.2：室友「踩上就占 / 路过就占」=====
 * 用户原话：「只要是舍友经过座位那个座位就被占了 不用再延迟什么的 只要经过就标记占位」。
 *
 * 一次调用 = 室友走完一步之后的**即时结算**，只扫**这一拍的 4 邻接**（≤4 格）：
 *   脚踩的那一格 + 沿这一步的方向、左右各一格。
 *   走出过道时，左右那两格就是过道两侧的座位 —— 于是「走过去」的字面效果
 *   就是「两边一整排都归你了」，和用户看到的那张图一致。
 *
 * 五条硬约束（每一条都是踩过的坑）：
 *   ① **只占空格**：`!aisle && !owner` —— 走道不占，别人的座位不抢。
 *   ② **不计分**：`claimTile` 的第 4 个参数 `'walk'` 不走 `claimFeedbackPlayer`
 *      → 零飘分、零音效、零连击、零任务进度。**这一条是刻意的**：一次路过占 3 格、
 *      每格都飘字弹特效，屏幕会糊成一片。记号（`t.hm`）才是这条功能的表达方式。
 *   ③ **不消耗 `left`、不写 `got`**：`left` 仍然只由「到位」那一拍扣
 *      → 时长（t）依旧是唯一会先到的那一档，倒计时药丸不会说谎。
 *   ④ **零 Math.random()**：不调 `addParticles`、不掷骰子（铁律 1）。
 *   ⑤ **零瞬时移动**：先把 `owner` 写掉再判断，判完立刻还原 —— 与 `helperTarget`
 *      里「试占一下」完全同一个手法。直接写 owner 会让 `hasFreeNeighbor` 看到
 *      一个假局面（可能误判玩家被围死 → 复位）。
 *
 * 返回值：这一拍占下的格数（0~3）。只给探针用，游戏逻辑不读。 */

function helperWalkClaim(h, mx, my) {
  var pl = actorById(h.owner);
  if (!pl || !pl.alive) return 0;
  /* 只占脚下这一格（用户：「经过座位就被占了」—— 踩到哪占哪，无需左右扩展）。
     左右扩展是 2026-10-22 第一版的过度设计，导致方向计算歧义 + 单格用例对不上。 */
  var c = h.c, r = h.r;
  if (!inB(c, r)) return 0;
  var t = grid[I(c, r)];
  if (t.aisle) return 0;
  if (t.owner) {
    if (t.owner !== pl.id) return 0;
    return 0;
  }
  /* 试占一下看会不会把玩家围死，无论如何立刻还原 */
  t.owner = pl.id;
  var safe = hasFreeNeighbor(pl.c, pl.r, pl.id);
  t.owner = null;
  if (!safe) return 0;

  claimTile(c, r, pl, 'walk');        /* 'walk' ≠ 'true' → 不飘分 */
  if (t.hm === 2 && t.owner === pl.id) t.hmh = 1;
  helperMarks.push({ c: c, r: r, t: ROOMIE_WALK_FLASH });
  walkFresh.push(I(c, r));
  h.claim = 1;
  return 1;
}

function updateHelpers(dt) {
  /* R3.2：先把上一批「刚经过」推进 / 到期清掉 */
  updateWalkFlash(dt);
  /* 占座扩散环的寿命（纯表现，和 helpers 循环无关 —— 室友走了环还在收尾） */
  for (var mi = helperMarks.length - 1; mi >= 0; mi--) {
    helperMarks[mi].t -= dt;
    if (helperMarks[mi].t <= 0) helperMarks.splice(mi, 1);
  }
  for (var i = helpers.length - 1; i >= 0; i--) {
    var h = helpers[i];
    h.t -= dt;
    if (h.bob > 0) h.bob = Math.max(0, h.bob - dt * 3);
    if (h.claim > 0) h.claim = Math.max(0, h.claim - dt * 2);
    if (h.bubble > 0) h.bubble = Math.max(0, h.bubble - dt);
    if (h.t <= 0 || h.left <= 0) { helpers.splice(i, 1); continue; }

    h.step -= dt * 1000;
    if (h.step > 0) continue;
    h.step = HELPER_STEP_MS;

    /* 目标格：**认准了就一直走**，直到它被别人占掉、或者连续 3 拍走不动才重选。
     *
     * 为什么必须加这一条（2026-10-20 用户反馈「室友……不要拘泥在一小块转」）：
     *   原来每一拍都重新调 helperTarget。玩家一边跑一边占座时，候选格每分钟都在变，
     *   而室友只有玩家 1/3 的速度 —— 于是它每 420ms 换一个更远的目标，
     *   永远走不到任何一格，整段时间就在原地小幅摆动，一格也占不下来。
     *   认准之后它才有「朝某个方向扩张」的行为，玩家也能看出它在往哪边铺。
     *   关掉 ROOMIE_OPEN_ON → 退回「每拍重选」的旧行为。 */
    var ti;
    if (ROOMIE_OPEN_ON && h.tc >= 0 && h.tc < grid.length && !grid[h.tc].owner && h.stall < 3) {
      ti = h.tc;
    } else {
      ti = helperTarget(h.c, h.r, h.owner);
      h.tc = ti;
    }
    if (ti < 0) {
      /* 一个候选格都没有 → 改前是**立刻走人**（`h.left = 0`）。
       * 2026-10-21 实测：这个分支比想象的常见得多 ——
       * 玩家站在走道十字口时（例如教室 `(14,8)`，四个邻格全是 aisle），
       * 一个候选都没有，**室友刚召唤就消失**。这是「帮忙时间短」的另一半根因，
       * 光把 `left` 从 3 提到 8 治不好（此时 `got` 还是 0）。
       * 改法：给 `ROOMIE_HELP_GRACE` 拍宽限，每拍重试；玩家走出十字口就继续干活。
       * 宽限用完还是没目标才走人 —— 不留僵尸跟班。 */
      if (ROOMIE_LONGER_ON) {
        h.idle = (h.idle || 0) + 1;
        if (h.idle <= ROOMIE_HELP_GRACE) continue;
      }
      h.left = 0;
      continue;
    }
    h.idle = 0;
    var tc = ti % COLS, tr = (ti / COLS) | 0;

    if (tc === h.c && tr === h.r) {
      /* 到位：替玩家把这格占下来（分数、连击、称号都算玩家的）。
       *
       * ⚠️ 阶段 8 追加 R3.2（2026-10-22）：`ROOMIE_WALK_ON` 打开时，这一格**早在
       *    「脚落上去的那一步」就被占掉了**（见下面 moved 分支的「踩上就占」），
       *    所以这里通常走 `else`（不重复计分、不重复消耗 left）。
       *    为什么不一刀删掉：关掉开关要能逐字退回阶段 8 行为；而且目标格是玩家自己
       *    占下的格子时，室友会「站在上面」——那时这个分支就是唯一的占座入口。 */
      var pl = actorById(h.owner);
      if (!pl || !pl.alive) { h.left = 0; continue; }
      if (!grid[I(tc, tr)].owner) {
        claimTile(tc, tr, pl, true);   /* viaHelper=true → 社交达人每占一座 +15 */
        /* 阶段 8 修（用户反馈「没有占座的标记」）：占下的那一格留一圈扩散环，
           0.6 秒内由大到小收住 —— 让玩家明确看到「刚刚这一格是室友帮我拿的」。
           纯表现层：只往 helperMarks 里塞一个对象，不碰 grid / 分数 / 随机数。 */
        helperMarks.push({ c: tc, r: tr, t: ROOMIE_WALK_FLASH });
        addParticles(CX(tc), CY(tr), 8, ['#7FD1FF', '#FFFFFF', '#C9F2EC'], 0.6);
        h.claim = 1;
        h.left--;
        h.got++;
      }
      continue;
    }

    /* 挪一格：先走差值大的轴，被挡就试另一轴，都不行就等下一拍 */
    var dcx = sgn(tc - h.c), dry = sgn(tr - h.r);
    var order = Math.abs(tc - h.c) >= Math.abs(tr - h.r)
      ? [[dcx, 0], [0, dry]]
      : [[0, dry], [dcx, 0]];
    var moved = false;
    for (var k = 0; k < 2; k++) {
      var mx = order[k][0], my = order[k][1];
      if (!mx && !my) continue;
      var nc2 = h.c + mx, nr2 = h.r + my;
      if (!inB(nc2, nr2)) continue;
      var t2 = grid[I(nc2, nr2)];
      /* 室友可以踩着自己雇主的路线走 —— 它本来就是在替这个玩家干活，
       * 而且这游戏里所有角色都是「走在座位上」的，踩在已占座位上跟踩空座没视觉差别。
       * 别人的路线照旧不能踩（那是抢座规则的一部分）。
       * 不放开这一条的话，玩家路线一长，室友就会被自己人的座位困在原地当僵尸。 */
      if (t2.owner && t2.owner !== h.owner) continue;
      for (var q = 0; q < 4; q++) if (DIRS[q].dx === mx && DIRS[q].dy === my) h.dir = DIRS[q];
      h.c = nc2; h.r = nr2; h.bob = 1;
      moved = true;
      /* 阶段 8 追加 R3.2「踩上就占 / 路过就占」（用户：经过就标记占位，不要延迟）。
       * 顺序不能反：先落脚步、再占 —— 占座判定要看到「室友已经站在这一格」。 */
      if (ROOMIE_WALK_ON && h.left > 0) helperWalkClaim(h, mx, my);
      break;
    }

    /* 实在走不动就自己走人，别留个僵尸跟班在原地杵着 */
    if (moved) h.stall = 0;
    else if (++h.stall >= 6) h.left = 0;
  }
  /* R3.2：本帧新走进来的格子已经全部 push 完了 → 把「刚经过」高亮的到期时间登记好。
     ⚠️ 顺序必须在循环**之后**：贴在循环前会被本帧的 push 打败（新格子一进来就归零）。 */
  for (var w = 0; w < walkFresh.length; w++) walkFreshT[w] = ROOMIE_WALK_FLASH;
}

function useSkill(a, slot) {
  if (!a || !a.alive || state !== 'play') return false;
  /* ⚠️ 2026-10-08 修（手册 §十七「技能在复活后状态正确」）：
     复位等待期（`penalty > 0`）**不能放技能**。玩家那时不在场上（要 2 秒后才
     被 `respawnPlayer` 送回走道），此时放「借道 / 冲刺」既没有意义，
     又会把冷却白扣掉 —— 而且是**先扣冷却再等 2 秒**，等于把这次施放吞了。
     `tryMovePlayer`（第 4918 行）早就有这道守卫了，技能这条路漏了 ——
     这就是「同一个状态两处判定不一致」。放在最前面，与移动输入同一时机被拦掉。 */
  if (a.penalty > 0) return false;
  /* V1.6 第二阶段：每个角色只有一个技能槽。这道守卫是**结构性**的 ——
     即使有陈旧的联机包或漏改的调用点送来 slot=1，也在这里被拦掉，
     不会走到下面去读一个不存在的技能。 */
  if (slot >= SKILL_SLOT_COUNT) return false;
  var id = a.skills[slot];
  if (!id || a.skillCd[slot] > 0) return false;
  var def = SKILLS[id];
  if (!def) return false;

  /* 图书馆安静区：冲刺在这里无效。**直接拒绝施放、把冷却还回去** ——
     否则玩家花了技能却只是「没变快」，既没有反馈又白亏一次冷却，是最难受的手感。
     教室的 quiet 是 null → sceneQuietBlocksDash 恒 false → 这个分支永不进入，
     与重构前逐字一致（技能路径在指纹回归里根本走不到，这里再加一道场景守卫）。 */
  if (id === 'dash' && sceneQuietBlocksDash(a)) {
    addFloat(CX(a.c), CY(a.r) - 42, '安静区 · 冲不起来', '#3C5A82', FS('fM'), 1.3);
    Sound.ui();
    return false;
  }

  /* 冷却倍率：第三阶段《充电自由》把 cdCut 压到 0.7，占满插座位之后技能转得更快 */
  a.skillCd[slot] = def.cd * (a.cdCut || 1);

  /* 阶段 10 前置：记一次「真的放出来了」。**必须写在冷却那一行之后** ——
     写在函数开头会把「安静区拒绝施放」「冷却没好」这些**没放出去**的尝试也算成使用，
     技能使用次数就虚高了。走到这一行 = 冷却已扣、技能必然生效。 */
  recSkill(a);

  if (id === 'map') {
    /* 学霸地图：纯表现层开关 —— 只让 drawMapHints 多画几笔，不碰任何模拟状态 */
    a.mapShow = def.dur;
    addFloat(CX(a.c), CY(a.r) - 42, '高价值座位亮起！', '#7B4B00', FS('fM'), 1.3);
  } else if (id === 'ghost') {
    /* 老师来了：把自己的占座路线藏起来，这段时间可以穿过去（见 tryMovePlayer） */
    a.ghost = def.dur;
    addFloat(CX(a.c), CY(a.r) - 42, '路线藏起来了！', '#4A3F6B', FS('fM'), 1.3);
  } else if (id === 'help') {
    var got = skillHelp(a);
    /* 成功时不再飘「室友来了！」—— 头顶的「剩 N 秒」药丸 + 技能横幅已经说了两遍。
     * 失败必须留：玩家得知道「没地方站了」，否则会以为是技能坏了。 */
    if (!got) addFloat(CX(a.c), CY(a.r) - 42, '没地方站了', '#0B6B62', FS('fM'), 1.3);
    else if (!ROOMIE_TIMER_ON) addFloat(CX(a.c), CY(a.r) - 42, '室友来了！', '#0B6B62', FS('fM'), 1.3);
  } else if (id === 'dash') {
    a.dash = def.dur;
    addFloat(CX(a.c), CY(a.r) - 42, '冲刺！', '#0B6B62', FS('fL'), 1.1);
  } else if (id === 'milk') {
    var hit = skillMilk(a);
    addFloat(CX(a.c), CY(a.r) - 42, hit ? st('同学都去喝奶茶了') : '附近没人', '#7B4B00', FS('fM'), 1.3);
  } else if (id === 'callout') {
    skillCallout(a);
    addFloat(CX(a.c), CY(a.r) - 42, st('点名了！'), '#8A2B2B', FS('fM'), 1.2);
  } else if (id === 'bike') {
    var mv = skillBike(a);
    addFloat(CX(a.c), CY(a.r) - 42, mv ? ('溜了 ' + mv + ' 格') : '前面堵死了', '#0B5B8A', FS('fM'), 1.3);
  } else if (id === 'cram') {
    a.cram = true;
    addFloat(CX(a.c), CY(a.r) - 42, '下个特殊座位翻倍', '#7B4B00', FS('fM'), 1.4);
  }

  Sound.skill();
  addParticles(CX(a.c), CY(a.r), 14, ['#FFD84D', '#FFFFFF', def.emoji ? '#FFE9A8' : '#FFFFFF'], 1.0);
  addBanner(def.emoji, st(def.name) + '！', st(def.toast), 'good');
  return true;
}

/* ---------- 人类玩家推进（含双人同座竞争） ----------
 * 单人时只有 1 个玩家，走的还是 V1 那条老路，行为不变；
 * 双人时先把两人的移动意图收齐，再按「先到 → Combo 高者 → 固定顺序」定胜负，
 * 完全不用随机。 */
function stepHumans(dt) {
  var intents = [], contestLosers = [], i, a, d, nm, first;
  for (i = 0; i < humans.length; i++) {
    a = humans[i];
    if (!a.alive) continue;
    /* 图书馆被管理员驱赶后的罚站（calmEvictFreeze 秒）：完全不接受移动输入。
       ⚠️ 2026-10-03 修：libEvict 一直都设了 h.freeze，但**只有 NPC 的 AI 查它**
       （npcStep 里那句 `if (n.freeze > 0) return;`），玩家的 stepHumans 从来不查
       → 罚站形同虚设，被赶完照样走。放在 actorInputDir 之前 ——
       罚站期间连「方向意图」都不该产生（否则会进 intents 参与双人抢座判定）。 */
    if (LIB_FIX_ON && a.freeze > 0) { a.stepTimer = 0; continue; }
    d = actorInputDir(a);
    if (!d) { a.stepTimer = 0; continue; }
    a.stepTimer -= dt;
    if (a.stepTimer > 0) continue;
    /* V1.6 第九阶段（手感修复）：首次长按延迟。
       这次按下的第一格立刻走；之后**先等 KEY_HOLD_DELAY_MS** 才开始按
       actorStepMs 连走。没有这一步，「按一下」（人手 150~260ms）会被 130ms 的
       步进间隔判成「按住」，变成按一次走两格。
       顺序很重要：必须在 takeTap() 之前取名字，否则轻点缓冲已经被清掉了。 */
    nm = actorInputName(a);
    first = (nm && !a.remote && a.input) ? a.input.takeKeyFirstStep(nm) : false;
    a.stepTimer = (first && KEY_DAS_ON ? KEY_HOLD_DELAY_MS : actorStepMs(a)) / 1000;
    if (a.remote) a.netTap = null;
    else a.input.takeTap();
    intents.push({ actor: a, dir: d });
  }
  if (!intents.length) return;

  if (intents.length > 1) {
    /* 同一帧扑向同一格 → 抢座大战 */
    var byTile = {};
    for (i = 0; i < intents.length; i++) {
      var it = intents[i];
      var nc = it.actor.c + it.dir.dx, nr = it.actor.r + it.dir.dy;
      if (!inB(nc, nr)) continue;
      var k = I(nc, nr);
      if (!byTile[k]) byTile[k] = [];
      byTile[k].push(it);
    }
    for (var kk in byTile) {
      if (byTile[kk].length < 2) continue;
      grid[kk].vsMark = 1.1;
      var names = [];
      for (i = 0; i < byTile[kk].length; i++) {
        names.push(byTile[kk][i].actor.name || byTile[kk][i].actor.id);
      }
      addBanner('⚡', '抢！', names.join(' vs '), 'bad');
      Sound.clash();
      shake(3, 0.14);
    }
    /* Combo 高者先手 —— 先到先得，同帧则比 Combo，再平就按固定顺序 */
    intents.sort(function (x, y) {
      if (y.actor.combo !== x.actor.combo) return y.actor.combo - x.actor.combo;
      return actors.indexOf(x.actor) - actors.indexOf(y.actor);
    });
    /* V1.6 第一阶段 ⑤：同帧争抢的「输家」不判碰撞。
     * 他按方向键时那一格还是空的，是被赢家（身体挡路，或者赢家刚占下的座位）挡住的，
     * 属于「挡路」而不是「撞座」—— 所以这里只算挡路、不扣分不复位。
     * 排序已经做完，所以每一组里排第一的是赢家、后面全是输家：纯下标比较，零随机消耗。 */
    for (var kl in byTile) {
      var grp = byTile[kl];
      for (i = 1; i < grp.length; i++) contestLosers.push(grp[i].actor);
    }
  }

  for (i = 0; i < intents.length; i++) {
    tryMovePlayer(intents[i].dir, intents[i].actor,
      contestLosers.indexOf(intents[i].actor) >= 0);
  }
}

/* 开场冲刺：只跑不占座，用来做「学生冲进教室」的动画 */
function npcRush(n) {
  var cands = [], i, d;
  for (i = 0; i < 4; i++) {
    d = DIRS[i];
    var nc = n.c + d.dx, nr = n.r + d.dy;
    if (!inB(nc, nr)) continue;
    if (grid[I(nc, nr)].owner) continue;
    var rev = (d.dx === -n.dir.dx && d.dy === -n.dir.dy);
    var sc = Math.random() * 1.4;
    if (d === n.dir) sc += 1.3;
    if (rev) sc -= 2.2;
    sc += n.bias(nc, nr);
    cands.push({ d: d, s: sc });
  }
  if (!cands.length) return;
  cands.sort(function (a, b) { return b.s - a.s; });
  var c = cands[0].d;
  n.dir = c;
  n.c += c.dx;
  n.r += c.dy;
  n.bob = 1;
}

function npcStep(n) {
  if (n.freeze > 0) return;              /* 被奶茶诱惑，先歇会儿 */

  var cands = [], i, d;
  for (i = 0; i < 4; i++) {
    d = DIRS[i];
    var nc = n.c + d.dx, nr = n.r + d.dy;
    if (!inB(nc, nr)) continue;
    if (grid[I(nc, nr)].owner) continue;
    /* 社交达人：他附近的特殊座位同学不去抢 */
    if (grid[I(nc, nr)].type !== 'normal' && socialReserved(nc, nr)) continue;
    var rev = (d.dx === -n.dir.dx && d.dy === -n.dir.dy);
    var s = Math.random() * 2.0;
    if (d === n.dir) s += 1.05;
    if (rev) s -= 1.5;
    s += n.bias(nc, nr);
    cands.push({ d: d, s: s });
  }

  if (!cands.length) {
    /* 走不动了，就地坐下（不会卡死游戏） */
    n.blocked = true;
    return;
  }

  cands.sort(function (a, b) { return b.s - a.s; });
  var chosen = cands[0].d;
  n.dir = chosen;
  n.c += chosen.dx;
  n.r += chosen.dy;
  n.bob = 1;
  var t = grid[I(n.c, n.r)];
  if (!t.aisle) claimTile(n.c, n.r, n);
}

/* ==========================================================
 * 10. 结束
 * ========================================================== */

/* 结束本局。
 * loser：出局的那个 Actor（时间到时为 null）。
 * 单人模式下永远等于 player，行为与 V1 完全一致。 */
/* ---------- 今日任务面板（HTML 层） ----------
 * 为什么不用画布画：横幅（drawBanners）是画在画布上的，两条叠起来时上面那条
 * 会顶到墙面区，正好压住黑板 —— 而横幅在抢特殊座位时几乎每几秒就弹一次。
 * 放进 HTML 层就永远不会被画布上的任何东西盖住，文字也更清晰。
 *
 * 位置是量出来的（测试台/combo-probe.js）：左上信息条在「连抢」展开 +
 * 四位分数的最坏情况下右边界到 x≈582（手机 420），右边计时牌从 x≈850
 * （手机 571）开始。面板就卡在中间这条空位上，四种版式都不打架。 */
var lastTaskPanel = '';

function layoutTaskPanel() {
  if (!elHudTasks || !elHudTasks.classList) return;
  elHudTasks.classList.remove('compact');
  elHudTasks.classList.remove('wide');
  elHudTasks.classList.add(COMPACT ? 'compact' : 'wide');
  lastTaskPanel = '';       /* 版式变了，行内容（短名 / 全名）得重写一次 */
}

/* ---- 任务面板的两个小工具（第九阶段 P1-1）----
 * 都是纯读：不写任何状态、不掷骰子、不碰 taskList 的长度。 */
function taskSigOf(i) {
  return taskList[i].id + ':' +
    (taskDone[i] ? 'd' : Math.floor(Math.min(taskProg[i], taskList[i].need)));
}
function taskRowHtml(i, isMain) {
  var t = taskList[i], done = taskDone[i];
  var need = t.need || 1;
  var n = Math.floor(Math.min(taskProg[i], need));
  var pct = Math.max(0, Math.min(100, Math.round(n / need * 100)));
  var row = '<div class="ht-row' + (isMain ? '' : ' sub') + (done ? ' done' : '') +
    '" title="' + t.name + ' · ' + t.unit + '">' +
    '<span class="ht-ico">' + t.icon + '</span>' +
    '<span class="ht-name">' + ((COMPACT && !isMain) ? t.short : t.name) + '</span>' +
    '<span class="ht-res">' + (done ? '✓' : n + '/' + need) + '</span>' +
    '</div>';
  if (!isMain) return row;
  /* 主任务多一条进度条 —— 文档 §四 要的 `■■■□ 3/4` 视觉。
     用真 DOM 画而不是字符，既不受字体影响，也能精确控制宽度。 */
  return '<div class="ht-main">' + row +
    '<div class="ht-bar"><i style="width:' + pct + '%"></i></div></div>';
}

function syncTaskPanel() {
  if (!elHudTasks || !elHudTasks.classList || !elHudTaskList) return;

  var show = TASKS_ON && taskList.length && !isVersus() &&
    (state === 'play' || state === 'count');
  if (!show) {
    if (lastTaskPanel !== 'off') {
      lastTaskPanel = 'off';
      elHudTasks.classList.add('hidden');
      elHudTaskList.innerHTML = '';
    }
    return;
  }

  /* ---- P1-1（第九阶段）：面板只画「1 主 + 1 次」 ----
   * 文档 §四：「设计成校园待办，始终最多显示 1 个当前主任务 + 1 个次任务」。
   * ⚠️ 这里**只改画哪几行**：任务奖励、进度累计、补新任务的逻辑一个字都没动 ——
   *    面板是纯展示层，改它不碰模拟。
   *
   * V1.6 第二阶段：TASK_COUNT = 1，taskList 本身就只剩 1 条，
   * 于是 si 恒为 -1、folded 恒为 0 —— 「1 主 + 1 次」的取舍逻辑原样留着，
   * 只是没有第二条可取舍了。面板不是「藏起来两条」，是**真的只有一条**。
   * 主任务 = 「进度比」最高的那条，**已完成的一律按 100% 算** ——
   *    这样刚做完的任务会占着主位显示 ✓（补新任务要等 2.5 秒，不留住的话
   *    玩家根本看不到自己完成了什么）。并列取靠前的；进度只增不减，所以不会来回跳。
   * 次任务 = 剩下第一条**未完成**的（已经做完的不占次位，次位要留给下一个目标）。 */
  var mi = -1, si = -1, k, best = -1;
  for (k = 0; k < taskList.length; k++) {
    var rt = taskDone[k] ? 1 : taskProg[k] / (taskList[k].need || 1);
    if (rt > best + 1e-9) { best = rt; mi = k; }
  }
  for (k = 0; k < taskList.length; k++) {
    if (k === mi || taskDone[k]) continue;
    si = k; break;
  }
  if (mi < 0) mi = 0;

  /* 只在「显示内容真的变了」时重写 DOM —— 这个函数每帧都被 syncHud 调到 */
  var sig = (COMPACT ? 'c' : 'w') + '|' + mi + '|' + si + '|' + taskSigOf(mi);
  if (si >= 0) sig += '|' + taskSigOf(si);
  if (sig === lastTaskPanel) return;
  lastTaskPanel = sig;

  var html = taskRowHtml(mi, true);
  if (si >= 0) html += taskRowHtml(si, false);
  elHudTaskList.innerHTML = html;
  /* 折叠掉的条数报在**标题行**上，而不是另起一行 ——
     紧凑版面板只有 142×70 的空间，多一行就会压住座位区（版面体检会红）。
     标题行本来就空着一截，顺手把「还有 N 个」放进去，零高度成本。 */
  if (elHudTaskHead) {
    var folded = taskList.length - (si >= 0 ? 2 : 1);
    elHudTaskHead.textContent = folded > 0 ? '今日任务 · 还有 ' + folded + ' 个' : '今日任务';
  }
  elHudTasks.classList.remove('hidden');
}

/* ---------- 结算：本局任务清单 + 拿到的称号 ----------
 * 只读 taskList / taskDone / player.titles，不碰任何随机数。 */
/* ==========================================================
 * 8d. 成就系统（V2 手册第八节）
 * ----------------------------------------------------------
 * 手册原文：「后排之王：累计抢到 100 个后排座 / 占座狂魔：单局占领 50 个座位 /
 * 黄金猎人：抢到 20 次黄金座 / 教室地产商：累计占领 1000 个座位」。
 * 关键词是**累计** —— 所以要跨局持久化，否则「1000 个座位」永远只能靠单局。
 *
 * ⚠️ 两条硬规矩（与前几个阶段一致）：
 *   1. **零 Math.random 消耗** —— 结算时的统计纯粹是「读 grid + 加加减减」，不掷骰子。
 *   2. **不改变模拟** —— 成就只读状态、只写 localStorage，绝不碰 grid / actor 的任何字段。
 *      所以有没有成就系统，一局的走向完全一样（指纹回归可证）。
 *
 * 统计口径（全部在 endGame 里一次性算完，不是每帧累加）：
 *   后排     = 最后两排里属于玩家的座位
 *   黄金座   = grid 里 type==='gold' 且属于玩家的座位
 *   封锁/抢赢 = 直接取 actor 上已有的 blockCount / winCount（V1 就有，不用新加计数器） */
var ACH_KEY = 'zhanzuo_ach_v1';

var ACHIEVEMENTS = [
  { id: 'backking', name: '后排之王',   emoji: '👑', metric: 'backTotal',  target: 100,  desc: '累计抢到 100 个后排座位' },
  { id: 'maniac',   name: '占座狂魔',   emoji: '🔥', metric: 'bestRound',  target: 50,   desc: '单局占领 50 个座位' },
  { id: 'goldhunt', name: '黄金猎人',   emoji: '🥇', metric: 'goldTotal',  target: 20,   desc: '累计抢到 20 个黄金座' },
  { id: 'realtor',  name: '教室地产商', emoji: '🏢', metric: 'seatsTotal', target: 1000, desc: '累计占领 1000 个座位' },
  { id: 'blocker',  name: '路障大师',   emoji: '🚧', metric: 'blockTotal', target: 30,   desc: '累计封锁同学 30 次' },
  { id: 'duelist',  name: '抢座之王',   emoji: '⚔️', metric: 'winTotal',   target: 50,   desc: '累计抢赢 50 次同座竞争' }
];

/* 累计量 + 已解锁表。null 表示还没从 localStorage 读过。 */
var achState = null;

function achDefaults() {
  return {
    backTotal: 0, bestRound: 0, goldTotal: 0,
    seatsTotal: 0, blockTotal: 0, winTotal: 0,
    unlocked: {}
  };
}

/* 读存档。localStorage 在 file:// / 隐私模式下会抛异常，一律吞掉退回默认值。
 * 存档字段缺了就补默认值 —— 以后加新成就时老存档也能用。 */
function achLoad() {
  var d = achDefaults();
  var raw = null;
  try { raw = localStorage.getItem(ACH_KEY); } catch (e) { raw = null; }
  if (raw) {
    var o = null;
    try { o = JSON.parse(raw); } catch (e) { o = null; }
    if (o && typeof o === 'object') {
      for (var k in d) {
        if (!d.hasOwnProperty(k)) continue;
        if (k === 'unlocked') {
          if (o.unlocked && typeof o.unlocked === 'object') d.unlocked = o.unlocked;
        } else if (typeof o[k] === 'number' && isFinite(o[k]) && o[k] >= 0) {
          d[k] = o[k];
        }
      }
    }
  }
  achState = d;
  return d;
}

function achSave() {
  if (!achState) return;
  try { localStorage.setItem(ACH_KEY, JSON.stringify(achState)); } catch (e) {}
}

/* 确保 achState 就绪（懒加载，避免脚本一载入就碰 localStorage）。 */
function achEnsure() { return achState || achLoad(); }

/* 把玩家这一局的成绩累加进存档，返回**本局新解锁**的成就数组。
 * 只在单人模式调用（见 endGame）—— 双人是对战报告，累计口径会含糊。
 * 整段不消耗随机数、不改任何模拟状态。 */
function achTally(a) {
  achEnsure();
  if (!a || !grid || !grid.length) return [];

  var seats = 0, back = 0, gold = 0, i, t;
  for (i = 0; i < grid.length; i++) {
    t = grid[i];
    if (t.owner !== a.id) continue;
    seats++;
    if (((i / COLS) | 0) >= ROWS - 2) back++;     /* 最后两排算「后排」 */
    if (t.type === 'gold') gold++;
  }

  achState.seatsTotal += seats;
  achState.backTotal  += back;
  achState.goldTotal  += gold;
  achState.blockTotal += (a.blockCount || 0);
  achState.winTotal   += (a.winCount || 0);
  if (seats > achState.bestRound) achState.bestRound = seats;

  var fresh = [], d;
  for (i = 0; i < ACHIEVEMENTS.length; i++) {
    d = ACHIEVEMENTS[i];
    if (achState.unlocked[d.id]) continue;
    if (achState[d.metric] >= d.target) {
      achState.unlocked[d.id] = 1;
      fresh.push(d);
    }
  }
  achSave();
  return fresh;
}

/* 还差得最少的那个未解锁成就（用来做进度提示）。全解锁了就返回 null。 */
function achNext() {
  achEnsure();
  var best = null, bestGap = Infinity, i, d, gap;
  for (i = 0; i < ACHIEVEMENTS.length; i++) {
    d = ACHIEVEMENTS[i];
    if (achState.unlocked[d.id]) continue;
    gap = d.target - (achState[d.metric] || 0);
    if (gap < bestGap) { bestGap = gap; best = d; }
  }
  return best;
}

/* 成就行的 DOM 内容。fresh 是本局新解锁的成就数组（可为空）。
 * 有解锁 → 列胶囊；没解锁 → 显示离最近的那个还差多少。二选一，永远只有一行。 */
function achFill(fresh) {
  if (!elOverAch) return;
  var html = '', i;

  if (fresh && fresh.length) {
    html = '<span class="ac-head">🏆 解锁成就</span>';
    for (i = 0; i < fresh.length; i++) {
      html += '<span class="ac">' + fresh[i].emoji + ' ' + fresh[i].name + '</span>';
    }
    elOverAch.innerHTML = html;
    elOverAch.className = 'over-ach';
    return;
  }

  var nx = achNext();
  if (nx) {
    var cur = achState[nx.metric] || 0;
    var left = nx.target - cur;
    elOverAch.innerHTML =
      '<span class="ac-hint">🏆 ' + nx.emoji + ' ' + nx.name +
      ' 还差 <b>' + left + '</b>（' + cur + '/' + nx.target + '）</span>';
    elOverAch.className = 'over-ach';
    return;
  }

  /* 全解锁：给一句收尾，别留空行 */
  elOverAch.innerHTML = '<span class="ac-hint">🏆 全部成就已解锁，教室归你了</span>';
  elOverAch.className = 'over-ach';
}

function fillOverTasks() {
  if (!elOverTasks) return;
  var on = TASKS_ON && taskList.length && !isVersus();
  if (!on) {
    elOverTasks.className = 'over-tasks hidden';
    if (elOverTitles) elOverTitles.className = 'over-titles hidden';
    return;
  }

  var html = '', i, t, done, cur;
  for (i = 0; i < taskList.length; i++) {
    t = taskList[i]; done = taskDone[i];
    cur = Math.floor(Math.min(taskProg[i], t.need));
    html += '<div class="ot-row' + (done ? ' done' : '') + '">' +
      '<span class="ot-ico">' + t.icon + '</span>' +
      '<span class="ot-name">' + t.name + '</span>' +
      '<span class="ot-res">' + (done ? '✓ 完成' : cur + '/' + t.need) + '</span>' +
      '</div>';
  }
  elOverTasks.innerHTML = html;
  elOverTasks.className = 'over-tasks';

  if (!elOverTitles) return;
  if (player.titles.length) {
    var th = '';
    for (i = 0; i < player.titles.length; i++) th += '<span class="tt">🏅 ' + player.titles[i] + '</span>';
    elOverTitles.innerHTML = th;
    elOverTitles.className = 'over-titles';
  } else {
    elOverTitles.innerHTML = '';
    elOverTitles.className = 'over-titles hidden';
  }
}

/* ==========================================================
 * 9b. 本局高光 + 角色评语（第九阶段 P1-2 / P1-3）
 * ----------------------------------------------------------
 * 文档 §十二：「突出一个本局高光」「只保留【再来一局】【换个角色】两个按钮」，
 *          并给了三句角色专属评价；§十三：高光「每局只记录 1~2 个」、
 *          「不要每隔几秒出现」。
 *
 * 两条硬规矩（和前几个阶段一致）：
 *   1. **零随机消耗** —— 高光纯粹是「读计数器 + 排个序」，一个骰子都不掷。
 *      角色评语那处做了等价改写（见 evalTextFor），随机流逐次对齐。
 *   2. **不改变模拟** —— 只读 actor 上的字段，绝不写回。
 * ========================================================== */

/* ---------- 本局高光 ----------
 * 刻意**不做**「局内每隔几秒冒一个高光」——文档明说不要那样。
 * 全部在结算时一次性算完，所以高光不可能干扰任何一帧的玩法。
 * 每条带一个 priority，排序后取前两条；并列时靠前的赢（顺序即优先级）。
 * 阈值都定在「这一局确实打得漂亮」的档位，宁可少给也不硬凑。 */
function roundHighlights(a) {
  var out = [];
  if (!a) return out;
  var sp = a.spBest || 0, mc = a.maxCombo || 0, wn = a.winCount || 0;
  var bk = a.blockCount || 0, spc = a.specialCount || 0, sc = a.seatCount || 0;
  if (sp >= 3) out.push({ p: 100 + sp, t: '连续抢下 ' + sp + ' 个特殊座位' });
  if (mc >= 6) out.push({ p: 90 + mc, t: '打出一波 ' + mc + ' 连抢' });
  if (wn >= 3) out.push({ p: 80 + wn * 2, t: '硬抢赢下 ' + wn + ' 个座位' });
  if (bk >= 5) out.push({ p: 70 + bk, t: '用占座路线封锁了 ' + bk + ' 个同学' });
  if (spc >= 8) out.push({ p: 60 + spc, t: '本局拿下 ' + spc + ' 个特殊座位' });
  if (sc >= 20) out.push({ p: 40 + sc, t: '一口气占了 ' + sc + ' 个座位' });
  out.sort(function (x, y) { return y.p - x.p; });
  return out;
}

function fillOverHighlight() {
  if (!elOverHighlight) return;
  var hl = roundHighlights(player);
  if (!hl.length) {
    /* 这一局打得太安静 —— 不给「高光」硬凑，直接收起整行，别让卡片凭空变高 */
    elOverHighlight.className = 'over-highlight hidden';
    elOverHighlight.innerHTML = '';
    return;
  }
  /* 单行内联排版（见 style.css 里 .over-highlight 的说明）——
     结算卡高度是硬约束，三行式会顶破标准版画布。 */
  var html = '<span class="hl-hd">✨ 本局高光</span>' +
    '<span class="hl-main">' + hl[0].t + '</span>';
  /* 文档 §十三「每局只记录 1~2 个」—— 有第二条就再挂一段，没有就只留一条 */
  if (hl.length > 1) html += '<span class="hl-sub">' + hl[1].t + '</span>';
  elOverHighlight.innerHTML = html;
  elOverHighlight.className = 'over-highlight';
}

/* ---------- 角色评语（P1-3） ----------
 * 文档 §十二 给了三句角色专属评价（学霸 / 摸鱼大师 / 社交达人），行动派补一句。
 *
 * ⚠️ 铁律：`pick(EVALS)` 的**输入长度一个字都不能动**。
 *    pick(arr) 的实现就是 arr[rand(arr.length)]，所以下面换成
 *        var evIdx = rand(EVALS.length);
 *    消耗的 Math.random 次数与 pick(EVALS) 完全一样，取到的下标也完全一样；
 *    无角色时 EVALS[evIdx] 逐字等于原来的 pick(EVALS)。
 *    拿到下标之后再按角色查表 —— 于是「抽哪一条」和「怎么说」彻底解耦：
 *    以后改文案、加角色，都不会重排任何一局的 NPC 走位。
 *
 * 每个角色 6 条，用 % 取模落到具体一条。文案刻意写得**跨场景通用**
 * （不出现「教室 / 上课」这类词），免得食堂里冒出教室味。 */
var ROLE_EVAL_LINES = {
  scholar: [
    '你甚至提前规划好了下课路线。',
    '笔记没记多少，座位倒是排满了。',
    '这排的性价比，你算过三遍。',
    '规划型选手：连巡逻的动线都算进去了。',
    '别人在学习，你在做座位排布优化。',
    '坐下之前，你已经想好了怎么走出去。'
  ],
  slacker: [
    '管理员转头三次，都没抓到你。',
    '整场你都在角落，但没人看见你。',
    '存在感低到同学以为这排没人。',
    '摸鱼的最高境界：人在，但等于不在。',
    '点名前一秒，你已经换好了位置。',
    '这局你几乎没动，但座位全是你的。'
  ],
  doer: [
    '你不是在占座，你是在冲刺。',
    '这速度，同学只看到一阵风。',
    '连抢奖励被你拿了两遍。',
    '别人还在选，你已经坐下了。',
    '行动派的占座方式：先占了再说。',
    '这局的节奏，是被你带起来的。'
  ],
  social: [
    '半个教室都是你朋友帮你占的。',
    '室友替你跑了一整趟。',
    '你没怎么动，座位自己来了。',
    '人缘好到可以不用亲自占座。',
    '这排是你朋友送的。',
    '同学看到你，主动让了位置。'
  ]
};

function evalTextFor(a, idx) {
  var base = EVALS[idx % EVALS.length];
  if (!a || !a.role) return base;
  var tbl = ROLE_EVAL_LINES[a.role.id];
  if (!tbl || !tbl.length) return base;
  return tbl[idx % tbl.length];
}

/* ===== V36 下一阶段 · 阶段 10 前置：对局数据记录器 =====
 * 文档阶段 10 要《V36 对局数据报告》，列了 9 个指标；而游戏此前**一个都没有采集**，
 * 结算页只有分数和占座数。这个记录器把 9 个指标在局末打成一行 JSON：
 *   ① 平均普通座 ② 平均特殊座 ③ 双方分差 ④ 碰撞次数 ⑤ 清理区争抢次数
 *   ⑥ 技能使用次数 ⑦ 技能是否集中在清理前后 ⑧ 领先方被反超次数 ⑨ 落后方最大追分幅度
 *
 * 三条硬约束：
 *   · **只读**：一个玩法字段都不改，只往 `rec` 里记数；
 *   · **零随机**：不掷任何随机数（连 evInt / hotRand 都不碰）；
 *   · 开关关掉 = 整段不跑（`REC_ON = false` 时 recTick / recSkill / recDump 第一行就返回）。
 *
 * 几个指标的口径（写死在这里，报告里必须照抄）：
 *   · 清理区争抢 = **清理执行的那一刻，两名玩家都站在 5×5 窗口内**（含边界）。
 *   · 技能集中在清理前后 = 施放时刻落在任一清理时间点 ±5 秒内。
 *   · 领先方被反超 = 逐帧看谁分高，领先者换人一次记一次（平分不计）。
 *   · 落后方最大追分幅度 = 该玩家「历史最大落后 − 当前落后」的最大值（分）。
 * 输出：`window.__rec` + 控制台一行 `[REC] {...}`。 */
var REC_ON = true;
var rec = null;

function recReset() {
  /* 开关关掉时**连对象都不建** —— 这样「关掉」是真正的零成本零痕迹，
     探针也能用 recState() === null 直接判「整段没跑」。 */
  if (!REC_ON) { rec = null; return; }
  rec = {
    skillUses: [0, 0], skillNearClean: [0, 0],
    cleanContest: 0, leadChanges: 0, comeback: [0, 0],
    gapMax: 0, lastLeader: -1, deficitMax: [0, 0]
  };
}

function recNearClean() {
  for (var i = 0; i < EV_CLEAN_AT.length; i++) {
    if (Math.abs(elapsed - EV_CLEAN_AT[i]) <= 5) return true;
  }
  return false;
}

function recTick() {
  if (!REC_ON || !rec || !isVersus() || humans.length < 2) return;
  var s0 = humans[0].score, s1 = humans[1].score;
  var gap = Math.abs(s0 - s1);
  if (gap > rec.gapMax) rec.gapMax = gap;
  if (s0 === s1) return;                       /* 平分不算任何人领先 */
  var leader = s0 > s1 ? 0 : 1;
  if (rec.lastLeader >= 0 && leader !== rec.lastLeader) rec.leadChanges++;
  rec.lastLeader = leader;
  var behind = 1 - leader;
  if (gap > rec.deficitMax[behind]) rec.deficitMax[behind] = gap;
  var back = rec.deficitMax[behind] - gap;
  if (back > rec.comeback[behind]) rec.comeback[behind] = back;
}

/* 清理执行那一刻，两人是否都在窗口里（这就是「清理区争抢」的判据） */
function recCleanContest(box) {
  if (!REC_ON || !rec || !box || !isVersus() || humans.length < 2) return;
  var W = EV_CLEAN_CLUSTER_W, H = EV_CLEAN_CLUSTER_H;
  var a = humans[0], b = humans[1];
  var inA = a.c >= box.c0 && a.c < box.c0 + W && a.r >= box.r0 && a.r < box.r0 + H;
  var inB = b.c >= box.c0 && b.c < box.c0 + W && b.r >= box.r0 && b.r < box.r0 + H;
  if (inA && inB) rec.cleanContest++;
}

function recSkill(a) {
  /* ⚠️ 这里**故意不要求双人**：单人也该记技能使用次数（报告要按模式分组看）。
     别的指标（分差 / 反超 / 争抢）单人本来就没意义，各自在自己的函数里判。 */
  if (!REC_ON || !rec || !a) return;
  var hi = humans.indexOf(a);
  if (hi < 0) return;
  rec.skillUses[hi]++;
  if (recNearClean()) rec.skillNearClean[hi]++;
}

function recDump(reason) {
  if (!REC_ON || !rec || !humans.length) return null;
  var o = {
    mode: MODE, scene: SCENE.id, reason: reason || '',
    score: humans.map(function (h) { return h.score; }),
    normalSeats: humans.map(function (h) { return Math.max(0, (h.claimCount || 0) - (h.specialCount || 0)); }),
    specialSeats: humans.map(function (h) { return h.specialCount || 0; }),
    gap: humans.length >= 2 ? Math.abs(humans[0].score - humans[1].score) : 0,
    penalty: humans.map(function (h) { return h.penaltyCount || 0; }),
    cleanContest: rec.cleanContest,
    skillUses: rec.skillUses.slice(),
    skillNearClean: rec.skillNearClean.slice(),
    leadChanges: rec.leadChanges,
    comeback: rec.comeback.slice(),
    gapMax: rec.gapMax
  };
  try {
    window.__rec = o;
    if (typeof console !== 'undefined' && console.log) console.log('[REC] ' + JSON.stringify(o));
  } catch (e) {}
  return o;
}

function endGame(reason, loser) {
  if (state !== 'play') return;
  state = 'over';

  /* V1.6 第二阶段：收场时把待清理预告一并撤掉。
     如果本局正好停在「管理员还有 2 秒到」那一刻，不清的话橙色圈会一直留在
     结算页背后的画布上。只撤可视状态、**不动 evCleanFired/evCleanIdx** ——
     那两个是回归基线要读的「本局跑了几次清理」，收场时抹掉就永远读到 0。 */
  evCleanClearMark();

  /* 引导随本局一起收场。走到第 3 步才算看完，中途撞车的不写存档
     —— 刚开局就撞车的新手最需要再看一遍。 */
  tutAbort();

  var out = isVersus() ? (loser || null) : player;
  if (out) out.alive = false;
  overDelay = 0.95;
  /* 阶段 10 前置：局末把这一局的 9 个指标打出去（只读，不改任何玩法状态） */
  recDump(reason);

  var REASON = {
    self: '撞到了自己的占座路线',
    npc: '撞上了同学占好的座位',
    blocked: '四面八方都被占满了',
    time: '上课铃响了，老师进来了'
  };
  elOverReason.textContent = REASON[reason] || '没位置了';

  if (reason !== 'time') Sound.crash();
  /* 下课铃 */
  Sound.bell();

  if (out) {
    shake(14, 0.5);
    addParticles(CX(out.c), CY(out.r), 30, ['#FF8A5B', '#FFD84D', '#FFFFFF'], 1.6);
    addFloat(CX(out.c), CY(out.r) - 30, '没位置了！', DANGER_STYLE.text, FS('fL'), 1.6);
  } else {
    shake(8, 0.35);
  }

  if (isVersus()) {
    /* V1.6 第一阶段 ⑥：双人只按积分判胜负，同分即平局。
     * 旧的两条口径都去掉：
     *   ① 「谁先出局谁输」—— 出局已经不再是结束条件（撞座改成扣分 + 复位）；
     *   ② 「同分比座位数」—— 座位数不该再当第二裁判，否则「只按积分」是假的。
     * 于是整局唯一还能把双人带进 endGame 的理由就是 'time'，
     * 这里也就退化成「比分数」这一件事。 */
    var winIdx = -1;
    if (humans.length > 1 && humans[0].score !== humans[1].score) {
      winIdx = humans[0].score > humans[1].score ? 0 : 1;
    }
    fillVersusReportByIdx(winIdx);

    /* 把结果同步给访客。
       V1.6 第三阶段：结算多了「特殊座位」「碰撞次数」两行，
       所以结果包也要带上 sp / pc —— 否则访客端的报告会少两行、显示成 0。 */
    if (isHost() && Net.connected()) {
      Net.send({
        t: 'o', reason: elOverReason.textContent, win: winIdx,
        a: humans.map(function (h) {
          return { st: h.seatCount, sc: h.score, sp: h.specialCount || 0,
                   mc: h.maxCombo, bk: h.blockCount, wn: h.winCount,
                   pc: h.penaltyCount || 0 };
        })
      });
    }

    elOverSolo.classList.add('hidden');
    elOverVs.classList.remove('hidden');
    elOver.classList.add('vs');
  } else {
    /* 最高分 */
    var prev = bestScore;
    if (player.score > bestScore) {
      bestScore = player.score;
      try { localStorage.setItem('zhanzuo_best_v1', String(bestScore)); } catch (e) {}
    }

    elStSeats.textContent = String(player.seatCount);
    elStSpecial.textContent = String(player.specialCount);
    elStWins.textContent = String(player.winCount);
    /* V2 第九节对战报告：把「封锁同学」也报出来。这个计数 V1 就有（blockCount），
       之前只在双人报告里显示，单人结算漏了。 */
    if (elStBlock) elStBlock.textContent = String(player.blockCount);
    elStCombo.textContent = String(player.maxCombo);
    elStScore.textContent = String(player.score);
    fillOverTasks();
    /* 成就（V2 第八节）。放在 fillOverTasks 之后 —— 它要读 player.titles 之外的累计存档，
       和任务/称号互不依赖，但顺序靠后更符合「先报本局、再报长期」的阅读节奏。
       注意：achTally 会写 localStorage，所以一局只调一次（endGame 开头已挡住重复进入）。 */
    achFill(achTally(player));
    /* P1-3：rand(EVALS.length) 与 pick(EVALS) 同序同消耗（pick 就是 arr[rand(len)]），
       所以这里换成先取下标、再按角色查表，随机流一个字没动。 */
    var evIdx = rand(EVALS.length);
    elOverEval.textContent = '“' + st(evalTextFor(player, evIdx)) + '”';
    /* P1-2：本局高光（只读计数器，零随机消耗） */
    fillOverHighlight();

    if (player.score > prev && player.score > 0) {
      elOverBest.innerHTML = '🏅 历史最高分 <b>' + bestScore + '</b> &nbsp;·&nbsp; <span class="newrec">新纪录！</span>';
    } else {
      elOverBest.innerHTML = '🏅 历史最高分 <b>' + bestScore + '</b>';
    }

    elOverSolo.classList.remove('hidden');
    elOverVs.classList.add('hidden');
    elOver.classList.remove('vs');
  }

  elHud.classList.add('hidden');
}

/* ---------- 对战报告 ---------- */
var VS_EVALS = [
  '你俩是把教室当自己家了吧。',
  '后排的战争，前排完全看不懂。',
  '这局抢得比食堂开饭还凶。',
  '输的那位，下次记得早点来。',
  '建议直接去申请两间教室。'
];

function fillVsCol(n, a) {
  $('vs-seats-' + n).textContent = String(a.seatCount);
  $('vs-special-' + n).textContent = String(a.specialCount || 0);
  $('vs-score-' + n).textContent = String(a.score);
  $('vs-pen-' + n).textContent = String(a.penaltyCount || 0);
  $('vs-combo-' + n).textContent = String(a.maxCombo);
  $('vs-block-' + n).textContent = String(a.blockCount);
  $('vs-win-' + n).textContent = String(a.winCount);
}

/* 兼容入口：早期版本按「Actor 对象」调用（撞死的那个传进来）。
 * V1.6 第一阶段 ⑥ 把破平逻辑合并到 fillVersusReportByIdx 一处 ——
 * 这里改成薄封装，保证两条入口永远不会给出相反的胜负结论。
 * 顺带一提：pick(VS_EVALS) 的随机消耗现在只发生一次（在下标版本里），
 * 如果以后真有调用点，也不会出现「一份报告吃掉两个随机数」的错位。 */
function fillVersusReport(out) {
  var winIdx = -1;
  if (out) {
    winIdx = (out === humans[0]) ? 1 : 0;
  } else if (humans.length > 1 && humans[0].score !== humans[1].score) {
    winIdx = humans[0].score > humans[1].score ? 0 : 1;
  }
  fillVersusReportByIdx(winIdx);
}

function showOverScreen() {
  elOver.classList.remove('hidden');
  Sound.over();
}

/* ==========================================================
 * 11. 流程
 * ========================================================== */

/* 选模式并开局：solo = V1 单人抢座，versus = 双人同屏对战 */
function startMode(mode) {
  MODE = (mode === 'versus') ? 'versus' : 'solo';
  beginCountdown();
}

function beginCountdown() {
  Sound.init();
  Sound.ui();
  Sound.bell();
  clearKeys();
  /* 开新一局前先把暂停摘掉（2026-10-10）：正常流程进不来（暂停时按不到开始页的按钮），
     但「重开」的入口不止一个，留一行兜底比事后排查划算。 */
  setPaused(false);
  applyKeymaps();
  if (stage.classList) stage.classList.toggle('versus', isVersus());
  syncModeUI();
  resetGame(false);
  state = 'count';
  countT = 3.0;
  lastCountShown = null;
  elStart.classList.add('hidden');
  elOver.classList.add('hidden');
  /* 规则页是开始页的兄弟节点，不会跟着 elStart 一起藏 —— 必须显式收起来 */
  if (rulesShown) hideRules();
  elCount.classList.remove('hidden');
  elHud.classList.remove('hidden');
}

function restart() {
  beginCountdown();
}

/* 【换个角色】（第九阶段 P1-2）：回开始页，让玩家改角色 / 场景 / 模式。
 * 只是把三个 screen 的显隐拨回去 + 把 state 拨回 'start' —— 不碰任何模拟状态：
 *   · state='start' 是本来就存在的状态（开始页的 NPC 演示跑的就是它），
 *     update() 里有专门分支，resetGame(true) 会负责重建演示局；
 *   · 真正开一局时 beginCountdown() 里的 resetGame(false) 会把一切重算，
 *     所以这里不需要手动清任何计数器。
 * 顺手把三个选择区刷一遍选中态，免得显示的和实际不一致。 */
function backToStart() {
  clearKeys();
  /* 兜底摘暂停（2026-10-10）：正常路径是 quitToStart() 先摘、再调这里，
     但结算卡上的【换个角色】也走这个函数 —— 万一那时 PAUSED 还挂着，
     开始页上会留一层遮罩。这里补一行，代价为零、也不会误伤（本来就是 false）。 */
  setPaused(false);
  state = 'start';
  /* 引导也要收掉：这一局结束了，气泡不该飘回开始页 */
  tutAbort();
  elOver.classList.add('hidden');
  elCount.classList.add('hidden');
  elHud.classList.add('hidden');
  /* 回到开始页时规则页必须是关着的（不改 state 的那份 Sound.ui 已经在下面调了） */
  if (elRules && elRules.classList) elRules.classList.add('hidden');
  rulesShown = false;
  elStart.classList.remove('hidden');
  syncModeUI();
  syncSceneUI();
  syncRoleUI();
  Sound.ui();
}

function toggleSound() {
  var on = Sound.toggle();
  btnSound.textContent = on ? '🔊' : '🔇';
  btnSound.classList.toggle('off', !on);
  if (on) Sound.ui();
}

/* ==========================================================
 * 11b. 暂停 / 退出（2026-10-10）
 * ----------------------------------------------------------
 * 需求：在「游戏进行页面」内加暂停与退出两个键。
 *
 * 设计口径：
 *   · 暂停**不是 state 的一个值**，而是与 state 正交的 PAUSED 布尔。
 *     理由：state 只回答「这一局走到哪一步」（count / play / over），
 *     暂停回答「这一步先停住」—— 并进 state 就要改所有 `state === 'play'`
 *     的判断（全文件 20 多处），风险远大于收益。
 *   · 暂停期间 update() 在算完 dt、跑完**演出**之后立刻 return：
 *       计时不推进（elapsed 不动）、NPC 不动、技能冷却不走、随机流一次都不掷。
 *     所以暂停**不可能**影响任何一局的走向，也进不了指纹（core / grid 零影响）。
 *     「演出」保留（particles / floats / banners / shake / 走路浮动的衰減）——
 *     否则画面会冻在半帧，看着像卡死。
 *   · 出口统一走 setPaused(false) + quitToStart() 两个函数，不留第二条路径。
 *
 * ⚠️ 暂停只允许在 count / play 两个状态进入：over 状态已经结束了，
 *    再「暂停」没有意义（结算卡本来就是静止的）。
 * ========================================================== */

/* 当前能不能暂停（只有真正的对局过程中可以） */
function canPause() {
  return (state === 'count' || state === 'play') && !isGuest();
}

/* 设置暂停态。on 为真 → 暂停；为假 → 继续。
 * 返回最终是否处于暂停态，方便调用方判断。 */
function setPaused(on) {
  on = !!on;
  if (on && !canPause()) return false;
  if (PAUSED === on) return PAUSED;
  PAUSED = on;
  /* 1B（2026-10-15）：暂停不吃连击窗口。
   *   进暂停：记下挂钟起点。
   *   出暂停：把这段时长**补给所有演员的 lastClaimAt**（纯算术、零随机消耗）——
   *   「上次占座到现在」于是不含暂停时间，恢复后连击窗口接着走。
   *   ⚠️ 开关关掉时这段整段不进 → 逐字回到 v36（暂停超过 2.6 秒后连击被清零）。
   *   ⚠️ 上面那句 `PAUSED === on` 早退保证同一段暂停只结算一次。 */
  if (COMBO_CLOCK_FIX_ON) {
    if (PAUSED) {
      pauseStartAt = performance.now();
    } else if (pauseStartAt >= 0) {
      var pd = performance.now() - pauseStartAt;
      pauseStartAt = -1;
      if (pd > 0) {
        for (var pi = 0; pi < actors.length; pi++) {
          /* 只平移「本局真的用过连击」的演员；初始哨兵 -1e9 不动，免得把它拉进窗口内 */
          if (actors[pi].lastClaimAt > -1e8) actors[pi].lastClaimAt += pd;
        }
      }
    }
  }
  /* 暂停 / 继续都要清一次按键：否则「按住方向键时按暂停」，
     松手前一直以为那个方向还按着，继续后角色会自己往前走一格。 */
  clearKeys();
  if (elPause) elPause.classList.toggle('hidden', !PAUSED);
  if (btnPause) {
    btnPause.textContent = PAUSED ? '▶️' : '⏸️';
    btnPause.title = PAUSED ? '继续（空格）' : '暂停 / 继续（空格）';
    btnPause.classList.toggle('pausing', PAUSED);
  }
  /* 联机时暂停只在本地生效（对局在房主那边跑），文案要说清楚，
     免得玩家以为「我暂停了对手也停了」。 */
  if (elPauseSub) {
    elPauseSub.textContent = isNet()
      ? '你这边停住了；联网对局仍在进行。'
      : '比赛暂停了，计时和同学都停着。';
  }
  Sound.ui();
  return PAUSED;
}

function togglePause() { return setPaused(!PAUSED); }

/* 退出本局：回开始页。与结算卡上的【换个角色】走同一个 backToStart() ——
 * 它已经把 state 拨回 'start'、收掉三个 screen、收掉引导、刷三处选中态。
 * 这里**只多两件事**：先把暂停摘掉（否则开始页上还挂着遮罩），再去掉暂停态。
 * ⚠️ 不弹二次确认：这是个「回开始页」的轻量操作，不是丢弃不可恢复的进度 ——
 *    一局 90 秒，重来成本极低，加确认框反而是打扰。 */
function quitToStart() {
  setPaused(false);
  backToStart();
}

/* ---------- 玩法规则面板（V1.6 第九阶段） ----------
 * 入口是开始页右上角那张「📖 玩法」小贴纸，出口有三个：
 * 卡片右上角的 ✕、卡片底部的「知道了，开抢！」、点卡片外的空白处；键盘上 Esc / 空格 / 回车也行。
 *
 * 纯 DOM 显隐，不碰任何模拟状态（不开局、不重置、不消耗随机数）——
 * 所以它进不了指纹，也永远不会影响一局的结果。
 * ⚠️ 开始一局时必须显式收起来（见 beginCountdown）：开始页被 .hidden 藏掉时
 *    规则页是它的兄弟节点，不会跟着藏，会浮在新一局上面。 */
var rulesShown = false;

/* 紧凑版（692×468）里规则列表装不下，靠内部滚动兜底。但 Chrome 的滚动条是
 * **覆盖式**的（实测 offsetWidth - clientWidth = 0，不占宽度、平时不显示），
 * 所以必须自己给一个「向下还有更多 ↓」的提示，否则玩家不知道还能往下滚。
 * 纯读几何量、不写任何游戏状态 —— 沙箱里 scrollHeight/clientHeight 是 undefined，
 * 会走到 0，比较结果为 false，等于什么都不做（不会炸）。 */
function syncRulesMore() {
  if (!elRulesMore || !elRulesMore.style) return;
  if (!rulesShown) { elRulesMore.style.display = 'none'; return; }
  var sh = (elRulesList && elRulesList.scrollHeight) || 0;
  var ch = (elRulesList && elRulesList.clientHeight) || 0;
  var st = (elRulesList && elRulesList.scrollTop) || 0;
  var more = sh > ch + 1 && (sh - ch - st) > 4;
  elRulesMore.style.display = more ? 'flex' : 'none';
}

function showRules() {
  if (!elRules || !elRules.classList) return;
  rulesShown = true;
  elRules.classList.remove('hidden');
  /* 必须等这一帧的布局算完再量，否则 clientHeight 还是 0 */
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(syncRulesMore);
  syncRulesMore();
  Sound.ui();
}

function hideRules() {
  if (!elRules || !elRules.classList) return;
  rulesShown = false;
  elRules.classList.add('hidden');
  if (elRulesMore && elRulesMore.style) elRulesMore.style.display = 'none';
  Sound.ui();
}

/* ==========================================================
 * 12. 更新
 * ========================================================== */

function update(dt) {
  /* 联机访客：模拟全在房主那边，这里只跑演出 + 回传自己的输入 */
  if (isGuest()) {
    updateVisual(dt);
    netTick += dt;
    if (netTick >= 0.05) { netTick = 0; netSendInput(); }
    return;
  }

  if (bumpT > 0) bumpT -= dt;
  if (shakeT > 0) shakeT -= dt;
  if (shakeT <= 0) shakeMag = 0;

  updateVisual(dt);

  /* ---- 暂停闸门（2026-10-10） ----
   * 位置很关键：必须排在 updateVisual 之后、所有模拟之前。
   *   · updateVisual 管的是烟花 / 飘字 / 横幅 / 走路浮动的衰减 —— 属于「演出」，
   *     暂停时继续跑（否则整幅画面会冻在半帧，看着像卡死）；
   *   · 从这一行往下全是「模拟」—— 倒计时、计时、NPC、技能冷却、引导计时、
   *     事件排程。暂停时一行都不许跑，否则计时会偷偷走、NPC 会继续抢座。
   * 因此这是唯一正确的插入点：演出留下，模拟全停。
   * ⚠️ 这里 return 得很早，所以**一个 Math.random() 都不会被消耗** ——
   *    暂停不可能影响任何一局的随机流（指纹 core / grid 零影响）。 */
  if (PAUSED) return;

  if (state === 'count') {
    countT -= dt;

    /* 开场动画：同学们先冲进教室抢位置（只跑不占座，避免抢跑） */
    for (var ci = 0; ci < npcs.length; ci++) {
      var cn = npcs[ci];
      cn.stepTimer -= dt;
      if (cn.stepTimer <= 0) {
        cn.stepTimer = 0.12 + Math.random() * 0.1;
        npcRush(cn);
      }
    }

    var show;
    if (countT > 2) show = 3;
    else if (countT > 1) show = 2;
    else if (countT > 0.42) show = 1;
    else show = 0;
    if (show !== lastCountShown) {
      lastCountShown = show;
      elCountNum.textContent = show === 0 ? '抢！' : String(show);
      elCountNum.classList.toggle('go', show === 0);
      /* 重放动画 */
      elCountNum.style.animation = 'none';
      void elCountNum.offsetWidth;
      elCountNum.style.animation = '';
      Sound.tick(show === 0);
    }
    if (countT <= 0) {
      elCount.classList.add('hidden');
      state = 'play';
      clearKeys();
      shake(5, 0.32);
      Sound.start();
      /* 开场「抢！」：手册 §九 的四项之外，本作额外保留的一个大型提示 ——
         它是「现在可以动了」的唯一全场信号，1.5 秒后自行消失。见报告 §6 待拍板。 */
      addBanner('🔔', '抢！', st('上课还有 1 分半'), 'milestone', 1.5, true);
      /* 引导从「真正能动」这一刻开始计时，倒计时那 3 秒不算 */
      tutBegin();
    }
    return;
  }

  if (state === 'start') {
    /* 演示模式：NPC 自己跑起来抢座 */
    for (var i = 0; i < npcs.length; i++) {
      var n = npcs[i];
      if (n.blocked) continue;
      n.stepTimer -= dt;
      if (n.stepTimer <= 0) {
        n.stepTimer = 0.26 + Math.random() * 0.22;
        npcStep(n);
      }
    }
    if (pctClaimed() > 0.5) resetGame(true);
    return;
  }

  if (state === 'over') {
    if (overDelay > 0) {
      overDelay -= dt;
      if (overDelay <= 0) showOverScreen();
    }
    return;
  }

  /* ---- 游戏中 ---- */
  elapsed += dt;
  timeLeft = GAME_TIME - elapsed;

  /* 最后 15 秒高潮（手册 §十一）。纯表现层：横幅 + 声音 + 一个纯表现标志，
     不消耗随机数、不改任何玩法状态 —— 指纹 core/grid 零影响。 */
  updateFinalRush();

  /* 技能 buff 与冷却 */
  for (var bi = 0; bi < actors.length; bi++) {
    var ba = actors[bi];
    /* ⚠️ 2026-10-08 修（手册 §十七「技能在复活后状态正确」）：
       复位等待期（`penalty > 0`）里，**主动技能时长一并冻结** —— 不只是不许再放。
       改前 `ghost`/`dash`/`rage`/`mapShow` 照常自减：玩家被撞 → 复位 2 秒里，
       他复位前刚放出的「借道」会白白烧掉 2 秒（实测 2.0 → 1.5 只花了 0.5 秒），
       等落地时技能已经废了。这与「2 秒后回到走道**继续**玩」的设定矛盾 ——
       复位期间玩家不在场上，那些 buff 也不该在场上**计**。
       `dash`/`rage` 是速度类、`mapShow` 是侦查类、`ghost` 是穿行类，四个都是
       「在场才有意义」的。冷却（skillCd，下面那个循环）**照常走**：冷却就是等待，
       复位本身也是等待，「复位完技能也转好了」符合直觉。
       ⚠️ 只对飞行中的 buff 加守卫，**不改任何数值**；开关关掉（V1.5）时
       penalty 恒为 0（V1.5 单人撞了就出局、双人也是这套复位，所以 V1.5 下
       这段守卫同样生效 —— 但那时没有 D、复位只在双人发生，行为与改造前逐字一致）。 */
    var buffFrozen = ba.penalty > 0;
    /* `slow` 是**对手**用「点名危机」施加的负面状态，不是自己的主动技能 ——
       复位期不冻结它（否则会变成「受罚反而免疫减益」）。所以它写在分支外，只减一次。 */
    if (ba.slow > 0) ba.slow = Math.max(0, ba.slow - dt);
    if (!buffFrozen) {
      if (ba.dash > 0) ba.dash = Math.max(0, ba.dash - dt);
      if (ba.rage > 0) ba.rage = Math.max(0, ba.rage - dt);
      if (ba.mapShow > 0) ba.mapShow = Math.max(0, ba.mapShow - dt);
    }
    if (ba.freeze > 0) ba.freeze = Math.max(0, ba.freeze - dt);
    /* ⚠️ `ghost` 也归「主动技能」那一类 —— 复位期同样冻结。
       （`mapShow` / `rage` 已在上面 buffFrozen 分支里处理，这里**不能**再减一次，
         否则复位期它们会被扣两倍。） */
    if (!buffFrozen && ba.ghost > 0) {
      ba.ghost = Math.max(0, ba.ghost - dt);
      /* 「老师来了」结束的那一帧要补一次围死判定：
       * 技能生效期间自己的路线算通路，所以 tryMovePlayer 里的围死判定会被漏掉。
       * 时间一到还站在死角里，就按正常规则处理。
       * V1.6 第一阶段起口径与 tryMovePlayer 完全一致：第三个参数传自己的 id
       * （自己的座位是通路）。D（2026-10-04）之后**两种模式都是惩罚复位** ——
       * 单人的「照 V1 出局」已由 `SOLO_PENALTY_ON` 接管（见 stuckOutcome）。 */
      if (ba.ghost === 0 && ba.alive && ba.kind === 'human' && !hasFreeNeighbor(ba.c, ba.r, ba.id)) {
        stuckOutcome(ba);
      }
    }
    /* V1.6 第一阶段：惩罚性碰撞的复位倒计时。
     * 归零的那一帧把人送回最近的空走道，并给一小段保护期（见 respawnPlayer）。
     * 只处理人类玩家；NPC 不进这套体系（penalty 恒为 0，这里是空转）。 */
    if (ba.penalty > 0) {
      ba.penalty = Math.max(0, ba.penalty - dt);
      if (ba.penalty === 0) respawnPlayer(ba);
    }
    if (ba.invuln > 0) ba.invuln = Math.max(0, ba.invuln - dt);
    for (var si = 0; si < ba.skillCd.length; si++) {
      if (ba.skillCd[si] > 0) ba.skillCd[si] = Math.max(0, ba.skillCd[si] - dt);
    }
  }

  /* 校园事件：放在人类推进之前，这样「老师巡视」的减速当帧就生效 */
  updateEvents(dt);

  /* 随机任务：紧跟事件后面。老师巡视的视野会重置《低调摸鱼》的安全计时，
   * 所以必须排在 updateEvents 之后，同一帧里先算视野再算任务。 */
  updateTasks(dt);

  /* NPC 随时间加快 */
  var speed = (NPC_BASE_STEP - (NPC_BASE_STEP - NPC_MIN_STEP) * clamp(elapsed / NPC_RAMP_SEC, 0, 1)) * npcPace();
  /* 食堂「开饭铃响」的全场加速。dineOn() 兜一道底 —— 万一场景在中途换了而状态没清干净，
     也不会去读 SCENE.dine.bellStepMult 而炸掉。 */
  var bellMult = (dineOn() && dineBell > 0) ? SCENE.dine.bellStepMult : 1;
  for (var k = 0; k < npcs.length; k++) {
    var m = npcs[k];
    if (m.blocked) continue;
    m.stepTimer -= dt;
    if (m.stepTimer <= 0) {
      /* m.pace 是 V2 第五节的「卷王走得更快」，m.rage 是 V2 第六节期末周狂暴的加速，
         libFinalWeek 是第六阶段图书馆「期末周开始！」的抢座加速，
         dineBell 是第七阶段食堂「开饭铃响」的全场加速。
         四者都只乘在**间隔**上，不改变 Math.random() 的调用次数 —— 所以随机序列本身没动。 */
      m.stepTimer = (speed / 1000) * (0.85 + Math.random() * 0.3) *
        (m.slow > 0 ? 1.8 : 1) * (m.pace || 1) * (m.rage > 0 ? 0.55 : 1) *
        (libFinalWeek > 0 ? 0.6 : 1) * bellMult;
      npcStep(m);
    }
  }

  /* 人类玩家推进（单人 1 个 / 双人 2 个） */
  stepHumans(dt);

  /* 新手引导：紧跟在人类推进之后 —— 它要读的是本帧最新的坐标与占座数。
     零随机消耗，所以放在哪儿都不会扰动 NPC 的随机流。 */
  tutUpdate(dt);

  /* 室友（社交达人的「求助室友」）。放在人类推进之后 ——
   * 这样它读到的玩家坐标是本帧最新的，找目标格才准。
   * 没有室友时这个循环空转，开销可忽略；没有角色的对局里永远进不来。 */
  updateHelpers(dt);

  /* 场景专属逻辑（第五阶段预留接口）。教室场景第一行就返回，零开销、零随机消耗。 */
  updateSceneHot(dt);

  /* 图书馆安静值（第六阶段）。同样是「教室第一行返回」——纯观察玩家有没有换格子，
     不消耗任何随机数，所以放在哪一帧都不会挪动既有的随机序列。 */
  updateLibCalm(dt);

  /* 食堂「排队长龙」的轨迹记录（第七阶段）。只读玩家当前格坐标、往数组里 push 一个
     纯数据对象，不掷骰子也不改任何模拟字段 —— 所以对既有随机序列是零影响。
     教室/图书馆下 dineOn() 为假，第一行就返回。 */
  updateDineTrail(dt);

  /* V2 第四节：王者后排 / 情侣座 / 黄金插座区的持续产出。
     关掉 V2_SEATS_ON 时第一行就返回 —— V1 与 V1.5 的行为一点不受影响。 */
  updateV2Seats(dt);

  /* 房主定时把状态广播给访客 */
  if (isHost()) {
    netTick += dt;
    if (netTick >= 0.08) { netTick = 0; netSendSnapshot(); }
  }

  /* 抢座标记 */
  var i2, t2;
  for (i2 = 0; i2 < grid.length; i2++) {
    t2 = grid[i2];
    if (t2.vsMark > 0) t2.vsMark = Math.max(0, t2.vsMark - dt);
    if (t2.owner || t2.type === 'normal') { t2.contest = false; continue; }
    var cc = i2 % COLS, rrr = (i2 / COLS) | 0;
    var nowC = isContested(cc, rrr, player);
    t2.contest = nowC;
    t2.contestT = nowC ? Math.min(1, t2.contestT + dt * 5) : Math.max(0, t2.contestT - dt * 5);
  }

  /* 定时提示：V1.5 把「黄金后排出现！」这类周期性横幅去掉了（手册要求减少普通弹窗），
   * 改成在地图上给一个空着的特殊座位打一圈「看这里」扩散光环 ——
   * 信息一点没少，但不再往屏幕中间糊一条横幅。
   * 这一段的 Math.random() 消耗与 V1 完全一致，整局随机序列不受影响。 */
  alertTimer -= dt;
  if (alertTimer <= 0) {
    alertTimer = 16 + Math.random() * 8;
    var emptySpecial = [];
    for (i2 = 0; i2 < grid.length; i2++) {
      if (!grid[i2].owner && grid[i2].type === 'gold') emptySpecial.push(i2);
    }
    if (!emptySpecial.length) {
      for (i2 = 0; i2 < grid.length; i2++) {
        if (!grid[i2].owner && grid[i2].type !== 'normal') emptySpecial.push(i2);
      }
    }
    hintTile = emptySpecial.length ? emptySpecial[0] : -1;
    hintT = hintTile >= 0 ? 3.0 : 0;
  }
  if (hintT > 0) hintT = Math.max(0, hintT - dt);

  /* 随机校园梗：间隔与随机消耗保持 V1 原样，只是每 3 次才画一次。
   * pick() 必须放在 if 外面 —— 放在里面会跳过随机数消耗，整局序列就错位了。 */
  tipTimer -= dt;
  if (tipTimer <= 0) {
    tipTimer = 11 + Math.random() * 9;
    var tipText = st(pick(SMALL_TIPS));
    tipN++;
    if (player.alive && tipN % 3 === 1) {
      /* 抬高一点、缩小一点，避开玩家头顶新加的朝向箭头 */
      addFloat(CX(player.c), CY(player.r) - 64, tipText, '#8A7A4A', FS('fS'), 1.5);
    }
  }

  /* 连击超时（1B：暂停时长已在恢复时补进 lastClaimAt → 暂停不吃窗口） */
  if (player.combo > 0 && performance.now() - player.lastClaimAt > COMBO_WINDOW) player.combo = 0;

  /* 阶段 10 前置：逐帧采一次「谁领先 / 落后多少」。
     **位置在倒计时判定之前**，这样最后一帧也能算进去 ——
     放 endGame 里就晚了：那时分数已经冻结，采不到「最后 0.1 秒被反超」。
     只读 humans[i].score，不写任何模拟字段、不掷随机数。 */
  recTick();

  /* 倒计时结束 */
  if (timeLeft <= 0) {
    timeLeft = 0;
    endGame('time');
  }
}

function updateVisual(dt) {
  var i;
  for (i = floats.length - 1; i >= 0; i--) {
    var f = floats[i];
    f.life -= dt;
    f.y -= dt * 34;
    if (f.life <= 0) floats.splice(i, 1);
  }
  for (i = parts.length - 1; i >= 0; i--) {
    var p = parts[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 260 * dt;
    p.vx *= 0.985;
    p.rot += p.vr * dt;
    if (p.life <= 0) parts.splice(i, 1);
  }
  for (i = banners.length - 1; i >= 0; i--) {
    banners[i].life -= dt;
    if (banners[i].life <= 0) banners.splice(i, 1);
  }
  for (i = 0; i < grid.length; i++) {
    var t = grid[i];
    if (t.anim > 0) t.anim = Math.max(0, t.anim - dt * 4.2);
    if (t.owner) t.claimAge += dt;
  }
  /* 遍历顺序保持「玩家在前、NPC 在后」，且气泡逻辑只跑 AI —— 
   * 顺序一变，Math.random 的消耗顺序就变了，整局随机序列会错位。 */
  for (i = 0; i < actors.length; i++) {
    var a = actors[i];
    a.bob = Math.max(0, a.bob - dt * 5);
    if (a.kind !== 'ai') {
      a.claimFlash = Math.max(0, a.claimFlash - dt * 3);
      continue;
    }
    if (a.bubble > 0) a.bubble -= dt;
    else {
      a.bubbleTimer -= dt;
      if (a.bubbleTimer <= 0) {
        a.bubbleTimer = 7 + Math.random() * 9;
        if (!a.blocked) { a.bubbleText = st(pick(a.lines)); a.bubble = 2.2; }
      }
    }
  }
}

/* ==========================================================
 * 13. 渲染
 * ========================================================== */

function buildBackground() {
  /* 先按当前场景把调色板调好，再画整张房间图 —— 教室 SCENE.pal 是 null，
     PAL 逐字回到基准，所以教室这张缓存图与重构前完全一致。 */
  applyScenePalette();
  bg.width = Math.round(CW * DPR);
  bg.height = Math.round(CH * DPR);
  bgx.setTransform(DPR, 0, 0, DPR, 0, 0);
  bgx.clearRect(0, 0, CW, CH);
  drawRoom(bgx);
  drawAllEmptySeats(bgx);
}

/* ---------- 地板材质（按场景分派） ----------
 * 教室走 wood 分支，逐字沿用重构前的木纹画法。 */
function drawFloorPattern(g, fy) {
  var i, y, x;
  var style = SCENE.floorStyle || 'wood';
  g.save();
  if (style === 'wood') {
    g.strokeStyle = 'rgba(176,140,86,.20)';
    g.lineWidth = 1;
    for (y = fy; y < CH; y += 13) {
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(CW, y + 0.5); g.stroke();
    }
    g.strokeStyle = 'rgba(176,140,86,.13)';
    for (i = 0; i < 40; i++) {
      var px = (i * 137) % CW;
      var py = fy + ((i * 61) % (CH - fy));
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + 26, py); g.stroke();
    }
  } else if (style === 'carpet') {
    /* 图书馆：地毯 —— 细密绒纹 + 每 4 格一条拼缝（方块地毯） */
    g.strokeStyle = 'rgba(120,116,142,.13)';
    g.lineWidth = 1;
    for (y = fy; y < CH; y += 5) {
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(CW, y + 0.5); g.stroke();
    }
    g.strokeStyle = 'rgba(108,104,132,.26)';
    g.lineWidth = 2;
    for (y = fy; y < CH; y += 4 * TILE) {
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(CW, y + 0.5); g.stroke();
    }
    for (x = 0; x < CW; x += 4 * TILE) {
      g.beginPath(); g.moveTo(x + 0.5, fy); g.lineTo(x + 0.5, CH); g.stroke();
    }
  } else {
    /* 食堂：防滑地砖 —— 方格网格 */
    g.strokeStyle = 'rgba(186,146,92,.22)';
    g.lineWidth = 1.4;
    for (y = fy; y < CH; y += TILE) {
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(CW, y + 0.5); g.stroke();
    }
    for (x = 0; x < CW; x += TILE) {
      g.beginPath(); g.moveTo(x + 0.5, fy); g.lineTo(x + 0.5, CH); g.stroke();
    }
  }
  g.restore();
}

/* ---------- 教室 ---------- */
/* 按走道把座位切成一块一块的“座位区”，用来做视觉分区 */
function computeBlocks() {
  var colRuns = [], rowRuns = [], i, cur = [];
  for (i = 0; i < COLS; i++) {
    if (isAisle(i, 0)) { if (cur.length) { colRuns.push(cur); cur = []; } }
    else cur.push(i);
  }
  if (cur.length) colRuns.push(cur);
  cur = [];
  for (i = 0; i < ROWS; i++) {
    if (isAisle(0, i)) { if (cur.length) { rowRuns.push(cur); cur = []; } }
    else cur.push(i);
  }
  if (cur.length) rowRuns.push(cur);
  return { cols: colRuns, rows: rowRuns };
}

/* 座位区地垫配色现在从 SCENE.tints 读（教室的旧值已搬进 SCENES.classroom.tints）。 */

/* 板书文字的横向落点。
 * 单人：按各场景原来的系数（教室 0.42 / 图书馆 0.38 / 食堂 0.30），一个字都不动。
 * 双人：顶部正中是两人共用的计时牌（`#stage.versus .hud-tr` 是 left:50% 居中），
 *   0.42 那一带正好被它压住半截 —— 计时牌是不透明的，露出来的那半截板书看着像排版事故。
 *   双人时统一挪到黑板左端，那一带本来就被 1P 的信息条盖着（见下面 drawFrontClassroom 的注释）。
 * 只影响绘制，不碰任何模拟字段，也不消耗随机数。 */
function boardTextX(bx, bw, k) {
  return bx + bw * (isVersus() ? 0.12 : k);
}

/* 教室前墙：黑板 + 板书 + 粉笔涂鸦 + 禁止占座便签 + 挂钟 + 讲台 + 课程表。
   从 drawRoom 里原样搬出来的（含 g.save()/restore() 与调用顺序），教室画面零变化。 */
function drawFrontClassroom(g, bx, by, bw, bh) {
  rr(g, bx + 3, by + 3, bw, bh, 8);
  g.fillStyle = 'rgba(120,96,60,.28)'; g.fill();
  rr(g, bx, by, bw, bh, 8);
  g.fillStyle = PAL.board; g.fill();
  g.strokeStyle = PAL.boardEdge; g.lineWidth = 5 * DECO; g.stroke();
  rr(g, bx + 8, by + 8, bw - 16, bh - 16, 4);
  g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1.5; g.stroke();

  /* 板书靠左写：黑板中间偏右那块是第三阶段「今日任务」面板的位置
   * （见 layoutTaskPanel，HTML 层，永远压在画布之上）。标题挪到左半边之后，
   * 开局演示画面（HUD 隐藏）里看得见，开打后被左上信息条盖住，不打架。 */
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.font = font(FD('h1'), 800);
  g.fillText(SCENE.board.title, boardTextX(bx, bw, 0.42), by + bh * 0.42);
  g.fillStyle = 'rgba(255,255,255,.52)';
  g.font = font(FD('h2'), 600);
  g.fillText(SCENE.board.sub, boardTextX(bx, bw, 0.42), by + bh * 0.76);
  /* 粉笔涂鸦 */
  g.strokeStyle = 'rgba(255,255,255,.35)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(bx + 26, by + bh * 0.74);
  g.quadraticCurveTo(bx + 44, by + bh * 0.56, bx + 62, by + bh * 0.75);
  g.stroke();

  /* 左上：禁止占座便签 */
  g.save();
  g.translate(WALL_L + 50, 36 * DECO); g.rotate(-0.07);
  rr(g, -62 * DECO, -27 * DECO, 124 * DECO, 54 * DECO, 6);
  g.fillStyle = '#FFF0B8'; g.fill();
  g.strokeStyle = '#E0C468'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#B03A2E';
  g.font = font(FD('reward'), 900);
  g.fillText('禁止占座', 0, -6 * DECO);
  g.fillStyle = '#9A8A60';
  g.font = font(FD('sub'), 600);
  g.fillText('（本游戏除外）', 0, 13 * DECO);
  g.restore();

  /* 右上：挂钟 */
  g.save();
  g.translate(CW - 110 * DECO, 40 * DECO);
  var cr = 25 * DECO;
  g.beginPath(); g.arc(0, 0, cr, 0, 6.2832);
  g.fillStyle = '#FFFFFF'; g.fill();
  g.strokeStyle = '#4A4137'; g.lineWidth = 4 * DECO; g.stroke();
  g.strokeStyle = '#8A7F70'; g.lineWidth = 2 * DECO;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -cr * 0.6); g.stroke();
  g.beginPath(); g.moveTo(0, 0); g.lineTo(cr * 0.44, cr * 0.16); g.stroke();
  g.fillStyle = '#4A4137';
  g.beginPath(); g.arc(0, 0, 2.6 * DECO, 0, 6.2832); g.fill();
  g.fillStyle = '#9A8F80';
  g.font = font(FD('tag'), 700);
  g.textAlign = 'center';
  g.fillText('12', 0, -cr * 0.68);
  g.restore();

  /* 讲台 */
  g.save();
  var px0 = WALL_L - 12, py0 = WALL_T - 34 * DECO;
  rr(g, px0, py0, 128 * DECO, 30 * DECO, 7);
  g.fillStyle = '#C79A5E'; g.fill();
  g.strokeStyle = '#8A6430'; g.lineWidth = 3; g.stroke();
  rr(g, px0 + 8 * DECO, py0 + 5 * DECO, 112 * DECO, 11 * DECO, 4);
  g.fillStyle = '#E0B77A'; g.fill();
  g.fillStyle = '#5B4020';
  g.font = font(FD('task'), 800);
  g.textAlign = 'center';
  g.fillText('讲 台', px0 + 64 * DECO, py0 + 23 * DECO);
  g.restore();

  /* 课程表 */
  g.save();
  g.translate(CW - 174 * DECO, WALL_T - 22 * DECO);
  rr(g, -78 * DECO, -16 * DECO, 156 * DECO, 32 * DECO, 5);
  g.fillStyle = '#FFFFFF'; g.fill();
  g.strokeStyle = '#C9BCA4'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#3A6B5E';
  g.font = font(FD('task'), 800);
  g.textAlign = 'center';
  g.fillText('课程表 · 今天满课', 0, 0);
  g.strokeStyle = '#E4DCCB'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(-60 * DECO, 8 * DECO); g.lineTo(60 * DECO, 8 * DECO); g.stroke();
  g.restore();
}

/* 图书馆前墙：公告栏（代替黑板）+ 借阅台 + 「静」字牌 + 开放时间表。
 * 几何与教室黑板相同（bx/by/bw/bh 由 drawRoom 算好传进来），只是内容和配色换了。 */
function drawFrontLibrary(g, bx, by, bw, bh) {
  var i;
  /* 公告栏：木框 + 深蓝板面（PAL.board 由场景调色板换成墨蓝） */
  rr(g, bx + 3, by + 3, bw, bh, 8);
  g.fillStyle = 'rgba(120,96,60,.28)'; g.fill();
  rr(g, bx, by, bw, bh, 8);
  g.fillStyle = PAL.board; g.fill();
  g.strokeStyle = PAL.boardEdge; g.lineWidth = 5 * DECO; g.stroke();
  rr(g, bx + 8, by + 8, bw - 16, bh - 16, 4);
  g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1.5; g.stroke();

  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.font = font(FD('h1'), 800);
  g.fillText(SCENE.board.title, boardTextX(bx, bw, 0.38), by + bh * 0.42);
  g.fillStyle = 'rgba(255,255,255,.52)';
  g.font = font(FD('h2'), 600);
  g.fillText(SCENE.board.sub, boardTextX(bx, bw, 0.38), by + bh * 0.76);

  /* 公告栏右半边：三张彩色通知纸 + 红色图钉（图书馆特有的「信息墙」） */
  for (i = 0; i < 3; i++) {
    var nx = bx + bw * 0.70 + i * 30 * DECO;
    var ny = by + bh * 0.32 + (i % 2) * 9 * DECO;
    g.save();
    g.translate(nx, ny); g.rotate((i - 1) * 0.07);
    rr(g, -11 * DECO, -13 * DECO, 22 * DECO, 26 * DECO, 2);
    g.fillStyle = ['#FFF3C4', '#D8F0DC', '#FFE0DC'][i]; g.fill();
    g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#D9480F';
    g.beginPath(); g.arc(0, -13 * DECO, 2.2 * DECO, 0, 6.2832); g.fill();
    g.restore();
  }

  /* 左上：圆形「静」字牌（教室那边是「禁止占座」便签） */
  g.save();
  g.translate(WALL_L + 52, 36 * DECO); g.rotate(-0.05);
  rr(g, -58 * DECO, -27 * DECO, 116 * DECO, 54 * DECO, 8);
  g.fillStyle = '#EAF2FF'; g.fill();
  g.strokeStyle = '#9DB9DC'; g.lineWidth = 2.4; g.stroke();
  g.fillStyle = '#2C5F96';
  g.font = font(FD('signL'), 900);
  g.fillText('静', -24 * DECO, 1 * DECO);
  g.fillStyle = '#6E86A6';
  g.font = font(FD('sub'), 700);
  g.fillText('手机静音', 22 * DECO, -5 * DECO);
  g.fillText('禁止饮食', 22 * DECO, 10 * DECO);
  g.restore();

  /* 右上：阅览室人流屏（比挂钟更贴图书馆） */
  g.save();
  g.translate(CW - 108 * DECO, 40 * DECO);
  rr(g, -46 * DECO, -24 * DECO, 92 * DECO, 48 * DECO, 6);
  g.fillStyle = '#22314A'; g.fill();
  g.strokeStyle = '#4A4137'; g.lineWidth = 3.4 * DECO; g.stroke();
  g.fillStyle = '#7FD8A8';
  g.font = font(FD('reward'), 900);
  g.textAlign = 'center';
  g.fillText('空位 42', 0, -6 * DECO);
  g.fillStyle = 'rgba(127,216,168,.55)';
  g.font = font(FD('tag'), 700);
  g.fillText('在馆 128 人', 0, 12 * DECO);
  g.restore();

  /* 借阅台（代替讲台）：长条桌 + 扫描枪 + 两摞书 */
  g.save();
  var lx = WALL_L - 12, ly = WALL_T - 34 * DECO;
  rr(g, lx, ly, 138 * DECO, 30 * DECO, 7);
  g.fillStyle = '#B08A5E'; g.fill();
  g.strokeStyle = '#7A5A34'; g.lineWidth = 3; g.stroke();
  rr(g, lx + 8 * DECO, ly + 5 * DECO, 122 * DECO, 11 * DECO, 4);
  g.fillStyle = '#D8B98A'; g.fill();
  g.fillStyle = '#4A3418';
  g.font = font(FD('task'), 800);
  g.textAlign = 'center';
  g.fillText('借 阅 台', lx + 69 * DECO, ly + 23 * DECO);
  /* 台面上两摞书 */
  for (i = 0; i < 2; i++) {
    var sx = lx + 100 * DECO + i * 17 * DECO;
    rr(g, sx, ly - 4 * DECO, 15 * DECO, 4 * DECO, 1.5);
    g.fillStyle = ['#C94F4F', '#4F7BC9'][i]; g.fill();
    g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 1; g.stroke();
    rr(g, sx, ly - 8 * DECO, 15 * DECO, 4 * DECO, 1.5);
    g.fillStyle = ['#E0A33A', '#5FAE7C'][i]; g.fill();
    g.strokeStyle = 'rgba(0,0,0,.2)'; g.stroke();
  }
  g.restore();

  /* 开放时间表 */
  g.save();
  g.translate(CW - 176 * DECO, WALL_T - 22 * DECO);
  rr(g, -78 * DECO, -16 * DECO, 156 * DECO, 32 * DECO, 5);
  g.fillStyle = '#FFFFFF'; g.fill();
  g.strokeStyle = '#C9BCA4'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#33436B';
  g.font = font(FD('task'), 800);
  g.textAlign = 'center';
  g.fillText('开放 08:00 - 22:00', 0, 0);
  g.strokeStyle = '#E4DCCB'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(-60 * DECO, 8 * DECO); g.lineTo(60 * DECO, 8 * DECO); g.stroke();
  g.restore();
}

/* 食堂前墙：菜单牌（代替黑板）+ 打饭窗口 + 餐价牌 + 消毒柜。
 * 菜单牌用暖红底（PAL.board 被场景调色板换成 #C1452B），一眼就区别于教室的墨绿黑板。 */
function drawFrontCanteen(g, bx, by, bw, bh) {
  var i;
  /* 菜单牌 */
  rr(g, bx + 3, by + 3, bw, bh, 8);
  g.fillStyle = 'rgba(120,96,60,.28)'; g.fill();
  rr(g, bx, by, bw, bh, 8);
  g.fillStyle = PAL.board; g.fill();
  g.strokeStyle = PAL.boardEdge; g.lineWidth = 5 * DECO; g.stroke();
  rr(g, bx + 8, by + 8, bw - 16, bh - 16, 4);
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1.5; g.stroke();

  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,.95)';
  g.font = font(FD('h1'), 800);
  g.fillText(SCENE.board.title, boardTextX(bx, bw, 0.30), by + bh * 0.36);
  g.fillStyle = 'rgba(255,255,255,.62)';
  g.font = font(FD('h2'), 600);
  g.fillText(SCENE.board.sub, boardTextX(bx, bw, 0.30), by + bh * 0.74);

  /* 菜单牌右半边：三行菜 + 价格（食堂特有的「价目表」） */
  var dishes = [['红烧肉', '12'], ['糖醋排骨', '14'], ['番茄炒蛋', '8']];
  for (i = 0; i < 3; i++) {
    var dy2 = by + bh * 0.26 + i * 15 * DECO;
    g.fillStyle = 'rgba(255,255,255,.90)';
    g.font = font(FD('task'), 800);
    g.textAlign = 'left';
    g.fillText(dishes[i][0], bx + bw * 0.60, dy2);
    g.fillStyle = '#FFE08A';
    g.font = font(FD('task'), 900);
    g.textAlign = 'right';
    g.fillText('￥' + dishes[i][1], bx + bw * 0.90, dy2);
    g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(bx + bw * 0.60, dy2 + 8 * DECO);
    g.lineTo(bx + bw * 0.90, dy2 + 8 * DECO);
    g.stroke();
  }
  g.textAlign = 'center';

  /* 左上：排队提示牌 */
  g.save();
  g.translate(WALL_L + 52, 36 * DECO); g.rotate(-0.06);
  rr(g, -58 * DECO, -27 * DECO, 116 * DECO, 54 * DECO, 6);
  g.fillStyle = '#FFF0C8'; g.fill();
  g.strokeStyle = '#E0B44A'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#B04A1E';
  g.font = font(FD('reward'), 900);
  g.fillText('自觉排队', 0, -6 * DECO);
  g.fillStyle = '#9A7A3C';
  g.font = font(FD('sub'), 600);
  g.fillText('（本游戏除外）', 0, 13 * DECO);
  g.restore();

  /* 右上：取餐号屏 */
  g.save();
  g.translate(CW - 108 * DECO, 40 * DECO);
  rr(g, -46 * DECO, -24 * DECO, 92 * DECO, 48 * DECO, 6);
  g.fillStyle = '#3A2A1A'; g.fill();
  g.strokeStyle = '#7A5A34'; g.lineWidth = 3.4 * DECO; g.stroke();
  g.fillStyle = '#FFB43A';
  g.font = font(FD('signS'), 900);
  g.textAlign = 'center';
  g.fillText('请 078 号', 0, -6 * DECO);
  g.fillStyle = 'rgba(255,180,58,.55)';
  g.font = font(FD('tag'), 700);
  g.fillText('取 餐', 0, 12 * DECO);
  g.restore();

  /* 打饭窗口（代替讲台）：不锈钢台面 + 两个菜盆 + 汤勺 */
  g.save();
  var cx2 = WALL_L - 12, cy2 = WALL_T - 34 * DECO;
  rr(g, cx2, cy2, 146 * DECO, 30 * DECO, 7);
  g.fillStyle = '#C9CED6'; g.fill();
  g.strokeStyle = '#8A9099'; g.lineWidth = 3; g.stroke();
  rr(g, cx2 + 8 * DECO, cy2 + 5 * DECO, 130 * DECO, 11 * DECO, 4);
  g.fillStyle = '#E4E9EF'; g.fill();
  g.fillStyle = '#4A4F57';
  g.font = font(FD('task'), 800);
  g.textAlign = 'center';
  g.fillText('打 饭 窗 口', cx2 + 73 * DECO, cy2 + 23 * DECO);
  /* 台面上两个菜盆 */
  for (i = 0; i < 2; i++) {
    var px2 = cx2 + 104 * DECO + i * 20 * DECO;
    g.beginPath();
    g.ellipse(px2, cy2 - 3 * DECO, 9 * DECO, 5 * DECO, 0, 0, 6.2832);
    g.fillStyle = '#EDEFF2'; g.fill();
    g.strokeStyle = '#9AA0A8'; g.lineWidth = 1.6; g.stroke();
    g.beginPath();
    g.ellipse(px2, cy2 - 4 * DECO, 6 * DECO, 3 * DECO, 0, 0, 6.2832);
    g.fillStyle = i ? '#D9673C' : '#8FBF5A'; g.fill();
  }
  g.restore();

  /* 消毒柜（代替课程表） */
  g.save();
  g.translate(CW - 176 * DECO, WALL_T - 22 * DECO);
  rr(g, -78 * DECO, -16 * DECO, 156 * DECO, 32 * DECO, 5);
  g.fillStyle = '#EFF2F5'; g.fill();
  g.strokeStyle = '#B6BCC4'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#3A6B8E';
  g.font = font(FD('task'), 800);
  g.textAlign = 'center';
  g.fillText('餐具已消毒 · 请自取', 0, 0);
  g.strokeStyle = '#DDE2E8'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(-60 * DECO, 8 * DECO); g.lineTo(60 * DECO, 8 * DECO); g.stroke();
  g.restore();
}

/* ---------- 图书馆 / 食堂的左右墙与道具 ----------
 * 左墙只有 WALL_L（标准 34 / 紧凑 24）宽，右墙 WALL_R 同宽，装饰必须小尺寸。
 * 这几个函数都只在 buildBackground() 里跑一次（结果进 bg 缓存），不吃每帧预算。 */

/* 图书馆左墙：整面书架。三层书脊 + 木框，与教室那排窗户同节奏（同样按 ROWS 均分）。 */
function drawLeftLibrary(g) {
  var i, j, k, y, sy;
  var shN = Math.max(2, Math.round(ROWS / 4));
  var area = ROWS * TILE;
  var shH = Math.min(112 * DECO, area / shN - 20);
  var gap = Math.max(6, (area - shN * shH) / (shN + 1));
  var shW = WALL_L - 6;
  var BOOKC = ['#C0504D', '#4F81BD', '#9BBB59', '#E0A33A', '#7C6BA8', '#3FA0A0'];
  for (i = 0; i < shN; i++) {
    y = GY + gap + i * (shH + gap);
    rr(g, 3, y - 3, shW + 4, shH + 6, 6);
    g.fillStyle = '#B08A5E'; g.fill();
    g.strokeStyle = '#7A5A34'; g.lineWidth = 2; g.stroke();
    var shelfH = (shH - 6) / 3;
    for (j = 0; j < 3; j++) {
      sy = y + j * shelfH;
      rr(g, 6, sy, shW - 2, shelfH - 2, 2);
      g.fillStyle = '#F0E4CE'; g.fill();
      /* 书脊高度/颜色用固定算式错开 —— 装饰里不许用随机数（会扰动整局随机序列） */
      var bw2 = (shW - 8) / 5;
      for (k = 0; k < 5; k++) {
        var bh2 = shelfH - 6 - ((i + j + k) % 3) * 1.5;
        g.fillStyle = BOOKC[(i * 3 + j * 5 + k) % BOOKC.length];
        g.fillRect(8 + k * bw2, sy + (shelfH - 4 - bh2), bw2 - 1.6, bh2);
      }
    }
  }
}

/* 食堂左墙：取餐台 —— 不锈钢台面 + 一排菜盆 + 保温灯。 */
function drawLeftCanteen(g) {
  var i;
  var top = GY + 10 * DECO, h = ROWS * TILE - 20 * DECO;
  g.fillStyle = '#D5DAE0';
  g.fillRect(3, top, WALL_L - 8, h);
  g.strokeStyle = '#9AA0A8'; g.lineWidth = 2;
  g.strokeRect(3, top, WALL_L - 8, h);
  var n = Math.max(3, Math.round(ROWS / 3));
  var step = (h - 34 * DECO) / n;
  for (i = 0; i < n; i++) {
    var y = top + 22 * DECO + i * step;
    /* 保温灯 */
    rr(g, 5, y - 13 * DECO, WALL_L - 12, 5 * DECO, 2);
    g.fillStyle = 'rgba(255,196,80,.85)'; g.fill();
    /* 菜盆（外圈不锈钢 + 内圈菜色） */
    var pcx = WALL_L / 2 - 2;
    g.beginPath();
    g.ellipse(pcx, y + 5 * DECO, (WALL_L - 16) / 2, 9 * DECO, 0, 0, 6.2832);
    g.fillStyle = '#EDEFF2'; g.fill();
    g.strokeStyle = '#9AA0A8'; g.lineWidth = 1.6; g.stroke();
    g.beginPath();
    g.ellipse(pcx, y + 4 * DECO, (WALL_L - 22) / 2, 5 * DECO, 0, 0, 6.2832);
    g.fillStyle = ['#D9673C', '#8FBF5A', '#E0A33A'][i % 3]; g.fill();
  }
}

/* 图书馆墙上的小物件：还书箱 + 「保持安静」贴纸（教室那边是自习贴纸 + 绿植 + 垃圾桶）。 */
function drawPropsLibrary(g, bx, bw) {
  g.save();
  g.translate(bx + bw * 0.18, WALL_T - 16 * DECO); g.rotate(0.045);
  rr(g, -44 * DECO, -14 * DECO, 88 * DECO, 28 * DECO, 5);
  g.fillStyle = '#DCE6F5'; g.fill();
  g.strokeStyle = '#8FA8CC'; g.lineWidth = 1.6; g.stroke();
  g.fillStyle = '#2C5F96';
  g.font = font(FD('sub'), 800);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('保持安静 · 请勿喧哗', 0, 0);
  g.restore();

  /* 还书箱（代替绿植） */
  g.save();
  g.translate(bx - 15 * DECO, WALL_T - 18 * DECO);
  g.scale(DECO, DECO);
  g.beginPath();
  g.moveTo(-11, 0); g.lineTo(11, 0); g.lineTo(9, 16); g.lineTo(-9, 16);
  g.closePath();
  g.fillStyle = '#7C8AA8'; g.fill();
  g.strokeStyle = '#4E5A72'; g.lineWidth = 2; g.stroke();
  rr(g, -13, -5, 26, 6, 2);
  g.fillStyle = '#95A3BE'; g.fill();
  g.strokeStyle = '#4E5A72'; g.lineWidth = 1.6; g.stroke();
  g.fillStyle = '#FFFFFF';
  g.font = font(FD('tag'), 800);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('还书', 0, 9);
  g.restore();

  /* 雨伞架（代替垃圾桶） */
  g.save();
  g.translate(CW - 65 * DECO, WALL_T - 18 * DECO);
  g.scale(DECO, DECO);
  g.beginPath();
  g.moveTo(-9, -6); g.lineTo(9, -6); g.lineTo(7, 13); g.lineTo(-7, 13);
  g.closePath();
  g.fillStyle = '#B8B2C6'; g.fill();
  g.strokeStyle = '#7A7488'; g.lineWidth = 2; g.stroke();
  g.strokeStyle = '#4A4658'; g.lineWidth = 2;
  for (var q = 0; q < 3; q++) {
    g.beginPath();
    g.moveTo(-5 + q * 5, -4); g.lineTo(-5 + q * 5, -14);
    g.stroke();
  }
  g.restore();
}

/* 食堂墙上的小物件：节约粮食贴纸 + 餐具回收桶 + 泔水桶。 */
function drawPropsCanteen(g, bx, bw) {
  g.save();
  g.translate(bx + bw * 0.18, WALL_T - 16 * DECO); g.rotate(0.045);
  rr(g, -44 * DECO, -14 * DECO, 88 * DECO, 28 * DECO, 5);
  g.fillStyle = '#FFE8C8'; g.fill();
  g.strokeStyle = '#E0B44A'; g.lineWidth = 1.6; g.stroke();
  g.fillStyle = '#A8560F';
  g.font = font(FD('sub'), 800);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('光盘行动 · 节约粮食', 0, 0);
  g.restore();

  /* 餐具回收桶 */
  g.save();
  g.translate(bx - 15 * DECO, WALL_T - 18 * DECO);
  g.scale(DECO, DECO);
  g.beginPath();
  g.moveTo(-10, -6); g.lineTo(10, -6); g.lineTo(8, 15); g.lineTo(-8, 15);
  g.closePath();
  g.fillStyle = '#8FBF5A'; g.fill();
  g.strokeStyle = '#5E8A32'; g.lineWidth = 2; g.stroke();
  rr(g, -12, -11, 24, 6, 2);
  g.fillStyle = '#A8D07C'; g.fill();
  g.strokeStyle = '#5E8A32'; g.lineWidth = 1.6; g.stroke();
  g.fillStyle = '#FFFFFF';
  g.font = font(FD('tag'), 800);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('回收', 0, 8);
  g.restore();

  /* 泔水桶 */
  g.save();
  g.translate(CW - 65 * DECO, WALL_T - 18 * DECO);
  g.scale(DECO, DECO);
  g.beginPath();
  g.moveTo(-9, -8); g.lineTo(9, -8); g.lineTo(7, 13); g.lineTo(-7, 13);
  g.closePath();
  g.fillStyle = '#C2C7CE'; g.fill();
  g.strokeStyle = '#868C95'; g.lineWidth = 2; g.stroke();
  rr(g, -11, -13, 22, 6, 2);
  g.fillStyle = '#A8AEB6'; g.fill();
  g.strokeStyle = '#868C95'; g.lineWidth = 1.6; g.stroke();
  g.restore();
}

/* 图书馆右墙：消防通道门 + 「安全出口」牌（教室那边是木门 + 出口）。 */
function drawRightLibrary(g) {
  var doorH = 150 * DECO;
  var dy = GY + ROWS * TILE - 188 * DECO;
  var doorW = WALL_R - 6;
  var doorX = CW - WALL_R + 3;
  rr(g, doorX, dy, doorW, doorH, 5);
  g.fillStyle = '#8E9AAE'; g.fill();
  g.strokeStyle = '#5A6578'; g.lineWidth = 3; g.stroke();
  /* 推杠 */
  rr(g, doorX + 4, dy + doorH * 0.46, doorW - 8, 6 * DECO, 3);
  g.fillStyle = '#D8DEE8'; g.fill();
  g.strokeStyle = '#5A6578'; g.lineWidth = 1.4; g.stroke();
  rr(g, doorX + 5, dy + 8, doorW - 10, doorH * 0.3, 3);
  g.fillStyle = 'rgba(255,255,255,.22)'; g.fill();

  g.save();
  g.translate(CW - 16, dy - 34 * DECO); g.rotate(1.5708);
  rr(g, -34 * DECO, -11 * DECO, 68 * DECO, 22 * DECO, 5);
  g.fillStyle = '#4FA84A'; g.fill();
  g.strokeStyle = '#2F7A2C'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#FFFFFF';
  g.font = font(FD('task'), 800);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('安全出口', 0, 0);
  g.restore();
}

/* 食堂右墙：后厨双开门 + 「后厨重地」牌。 */
function drawRightCanteen(g) {
  var doorH = 150 * DECO;
  var dy = GY + ROWS * TILE - 188 * DECO;
  var doorW = WALL_R - 6;
  var doorX = CW - WALL_R + 3;

  /* 右墙上半段：三扇窗。
     第七阶段把中段右带划成了「窗边桌」，区域名总得有东西撑着 ——
     否则玩家看着一条青色框，不知道它凭什么叫窗边。
     纯装饰，只在 buildBackground 里跑一次（结果进 bg 缓存），不吃每帧预算；
     窗户的间距/大小全用固定算式，装饰里一个随机数都不掷。 */
  var winN = 3;
  var winTop = GY + 22 * DECO;
  var winSpan = Math.max(winN * 30 * DECO, dy - 30 * DECO - winTop);
  var winStep = winSpan / winN;
  var winH = Math.min(78 * DECO, winStep - 16 * DECO);
  var winW = WALL_R - 10;
  var winX = CW - WALL_R + 5;
  for (var wq = 0; wq < winN; wq++) {
    var wy = winTop + wq * winStep + (winStep - winH) / 2;
    rr(g, winX, wy, winW, winH, 4);
    g.fillStyle = 'rgba(188,228,248,.95)'; g.fill();
    g.strokeStyle = '#8FA3B0'; g.lineWidth = 2.2; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(winX + winW / 2, wy + 3); g.lineTo(winX + winW / 2, wy + winH - 3);
    g.moveTo(winX + 3, wy + winH / 2); g.lineTo(winX + winW - 3, wy + winH / 2);
    g.stroke();
    /* 窗台 */
    rr(g, winX - 2, wy + winH, winW + 4, 4 * DECO, 2);
    g.fillStyle = '#D9B98D'; g.fill();
  }

  /* 双开门：左右各一扇 */
  rr(g, doorX, dy, doorW, doorH, 5);
  g.fillStyle = '#C9CED6'; g.fill();
  g.strokeStyle = '#868C95'; g.lineWidth = 3; g.stroke();
  g.strokeStyle = '#A6ACB4'; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(doorX + doorW / 2, dy + 4);
  g.lineTo(doorX + doorW / 2, dy + doorH - 4);
  g.stroke();
  /* 两个圆窗 */
  for (var q = 0; q < 2; q++) {
    g.beginPath();
    g.arc(doorX + doorW * (q ? 0.72 : 0.28), dy + doorH * 0.3, doorW * 0.16, 0, 6.2832);
    g.fillStyle = 'rgba(200,235,255,.9)'; g.fill();
    g.strokeStyle = '#868C95'; g.lineWidth = 1.6; g.stroke();
  }
  /* 把手 */
  g.fillStyle = '#FFD84D';
  g.beginPath(); g.arc(doorX + doorW * 0.42, dy + doorH * 0.62, 3.2, 0, 6.2832); g.fill();
  g.beginPath(); g.arc(doorX + doorW * 0.58, dy + doorH * 0.62, 3.2, 0, 6.2832); g.fill();

  g.save();
  g.translate(CW - 16, dy - 34 * DECO); g.rotate(1.5708);
  rr(g, -34 * DECO, -11 * DECO, 68 * DECO, 22 * DECO, 5);
  g.fillStyle = '#E0A33A'; g.fill();
  g.strokeStyle = '#A8761C'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#FFFFFF';
  g.font = font(FD('sub'), 800);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('后厨重地', 0, 0);
  g.restore();
}



function drawRoom(g) {
  var i, j, c, r, x, y;

  g.fillStyle = PAL.paper;
  g.fillRect(0, 0, CW, CH);

  /* ---- 地板（木纹） ---- */
  var fy = GY - 10;
  var grad = g.createLinearGradient(0, fy, 0, CH);
  grad.addColorStop(0, SCENE.floor[0]);
  grad.addColorStop(0.5, SCENE.floor[1]);
  grad.addColorStop(1, SCENE.floor[2]);
  g.fillStyle = grad;
  g.fillRect(0, fy, CW, CH - fy);

  /* ---- 地板纹理（木纹 / 地毯 / 地砖，按场景分派） ---- */
  drawFloorPattern(g, fy);

  /* ---- 座位区地垫 ---- */
  var blocks = computeBlocks();
  for (i = 0; i < blocks.cols.length; i++) {
    for (j = 0; j < blocks.rows.length; j++) {
      var cs = blocks.cols[i], rs = blocks.rows[j];
      var bx0 = TX(cs[0]) + 3, by0 = TY(rs[0]) + 3;
      var bw0 = cs.length * TILE - 6, bh0 = rs.length * TILE - 6;
      var tint = SCENE.tints[(i + j) % SCENE.tints.length];

      g.save();
      g.fillStyle = 'rgba(120,90,50,.13)';
      rr(g, bx0 + 2, by0 + 4, bw0, bh0, 12); g.fill();
      g.fillStyle = tint;
      rr(g, bx0, by0, bw0, bh0, 12); g.fill();
      g.strokeStyle = 'rgba(206,176,124,.45)';
      g.lineWidth = 2;
      g.stroke();
      g.restore();
    }
  }

  /* ---- 阶梯（每两排一级） ---- */
  for (r = 2; r < ROWS; r += 2) {
    y = TY(r);
    g.fillStyle = 'rgba(150,116,66,.05)';
    g.fillRect(WALL_L, y, COLS * TILE, 3);
    g.strokeStyle = 'rgba(150,116,66,.15)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(WALL_L, y + 0.5);
    g.lineTo(WALL_L + COLS * TILE, y + 0.5);
    g.stroke();
  }

  /* ---- 前墙 ---- */
  g.fillStyle = PAL.wall;
  g.fillRect(0, 0, CW, WALL_T);
  g.fillStyle = 'rgba(214,190,146,.35)';
  g.fillRect(0, WALL_T - 10, CW, 10);
  g.strokeStyle = PAL.wallLine;
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, WALL_T - 1.5); g.lineTo(CW, WALL_T - 1.5); g.stroke();

  /* 黑板 / 公告栏 / 菜单牌：外框几何三个场景共用，内容按场景分派。
     教室那份是从这里**原样搬进** drawFrontClassroom 的（调用顺序逐字保留），
     所以教室的缓存背景图与重构前像素一致（md5 比对已验证）。 */
  var bx = WALL_L + 144 * DECO, by = 12 * DECO;
  var bw = COLS * TILE - 288 * DECO, bh = 60 * DECO;
  if (SCENE.decor === 'classroom') drawFrontClassroom(g, bx, by, bw, bh);
  else if (SCENE.decor === 'library') drawFrontLibrary(g, bx, by, bw, bh);
  else drawFrontCanteen(g, bx, by, bw, bh);

  /* ---- 左墙（窗户） ---- */
  g.fillStyle = PAL.wall;
  g.fillRect(0, 0, WALL_L, CH);
  g.strokeStyle = PAL.wallLine; g.lineWidth = 3;
  g.beginPath(); g.moveTo(WALL_L - 1.5, 0); g.lineTo(WALL_L - 1.5, CH); g.stroke();

  if (SCENE.decor === 'classroom') {
    var winN = Math.max(2, Math.round(ROWS / 4));
    var winArea = ROWS * TILE;
    var winH = Math.min(112 * DECO, winArea / winN - 20);
    var winGap = Math.max(6, (winArea - winN * winH) / (winN + 1));
    var winW = WALL_L - 6;
    for (i = 0; i < winN; i++) {
      y = GY + winGap + i * (winH + winGap);
      /* 窗框 */
      rr(g, 3, y - 3, winW + 4, winH + 6, 6);
      g.fillStyle = '#FFFFFF'; g.fill();
      g.strokeStyle = '#C9B894'; g.lineWidth = 2; g.stroke();
      /* 玻璃（窗外是蓝天） */
      rr(g, 6, y, winW - 2, winH, 4);
      var wg = g.createLinearGradient(6, y, 6 + winW - 2, y + winH);
      wg.addColorStop(0, '#9FD8FF');
      wg.addColorStop(0.55, '#C6EBFF');
      wg.addColorStop(1, '#7FC6F0');
      g.fillStyle = wg; g.fill();
      /* 云 */
      g.fillStyle = 'rgba(255,255,255,.9)';
      g.beginPath(); g.arc(6 + winW * 0.32, y + winH * 0.25, winW * 0.2, 0, 6.2832); g.fill();
      g.beginPath(); g.arc(6 + winW * 0.62, y + winH * 0.28, winW * 0.16, 0, 6.2832); g.fill();
      g.beginPath(); g.arc(6 + winW * 0.42, y + winH * 0.72, winW * 0.18, 0, 6.2832); g.fill();
      /* 窗棂 */
      g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(6 + winW / 2, y + 2); g.lineTo(6 + winW / 2, y + winH - 2);
      g.stroke();
      g.beginPath();
      g.moveTo(7, y + winH / 2); g.lineTo(5 + winW, y + winH / 2);
      g.stroke();
    }
  } else if (SCENE.decor === 'library') {
    drawLeftLibrary(g);
  } else {
    drawLeftCanteen(g);
  }

  if (SCENE.decor === 'classroom') {
    /* ---- 墙上的小彩蛋 ---- */
    g.save();
    g.translate(bx + bw * 0.18, WALL_T - 16 * DECO); g.rotate(0.045);
    rr(g, -38 * DECO, -14 * DECO, 76 * DECO, 28 * DECO, 5);
    g.fillStyle = '#C9F0E4'; g.fill();
    g.strokeStyle = '#7FBFAE'; g.lineWidth = 1.6; g.stroke();
    g.fillStyle = '#2C6E5E';
    g.font = font(FD('sub'), 800);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('自习中 · 勿扰', 0, 0);
    g.restore();

    g.save();
    g.translate(bx + bw * 0.62, WALL_T - 17 * DECO); g.rotate(-0.05);
    rr(g, -46 * DECO, -14 * DECO, 92 * DECO, 28 * DECO, 5);
    g.fillStyle = '#FFE6B8'; g.fill();
    g.strokeStyle = '#E0B84A'; g.lineWidth = 1.6; g.stroke();
    g.fillStyle = '#8A5A00';
    g.font = font(FD('sub'), 800);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('占座请留纸条', 0, 0);
    g.restore();

    /* 绿植 */
    g.save();
    g.translate(bx - 15 * DECO, WALL_T - 18 * DECO);
    g.scale(DECO, DECO);
    g.beginPath();
    g.moveTo(-9, 0); g.lineTo(9, 0); g.lineTo(6, 15); g.lineTo(-6, 15);
    g.closePath();
    g.fillStyle = '#D98A5A'; g.fill();
    g.strokeStyle = '#9E5A32'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#5DBE7A';
    g.beginPath(); g.ellipse(-7, -7, 6, 10, -0.5, 0, 6.2832); g.fill();
    g.beginPath(); g.ellipse(7, -8, 6, 11, 0.5, 0, 6.2832); g.fill();
    g.beginPath(); g.ellipse(0, -13, 5, 12, 0, 0, 6.2832); g.fill();
    g.fillStyle = '#3E9B5C';
    g.beginPath(); g.ellipse(0, -10, 3, 7, 0, 0, 6.2832); g.fill();
    g.restore();

    /* 垃圾桶 */
    g.save();
    g.translate(CW - 65 * DECO, WALL_T - 18 * DECO);
    g.scale(DECO, DECO);
    g.beginPath();
    g.moveTo(-9, -8); g.lineTo(9, -8); g.lineTo(7, 13); g.lineTo(-7, 13);
    g.closePath();
    g.fillStyle = '#9CC2DE'; g.fill();
    g.strokeStyle = '#5E86A8'; g.lineWidth = 2; g.stroke();
    rr(g, -11, -13, 22, 6, 2);
    g.fillStyle = '#7BA6C6'; g.fill();
    g.strokeStyle = '#5E86A8'; g.lineWidth = 1.6; g.stroke();
    g.restore();
  } else if (SCENE.decor === 'library') {
    drawPropsLibrary(g, bx, bw);
  } else {
    drawPropsCanteen(g, bx, bw);
  }

  /* ---- 右墙（门） ---- */
  g.fillStyle = PAL.wall;
  g.fillRect(CW - WALL_R, 0, WALL_R, CH);
  g.strokeStyle = PAL.wallLine; g.lineWidth = 3;
  g.beginPath(); g.moveTo(CW - WALL_R + 1.5, 0); g.lineTo(CW - WALL_R + 1.5, CH); g.stroke();

  if (SCENE.decor === 'classroom') {
    var doorH = 150 * DECO;
    var dy = GY + ROWS * TILE - 188 * DECO;
    var doorW = WALL_R - 6;
    var doorX = CW - WALL_R + 3;
    rr(g, doorX, dy, doorW, doorH, 5);
    g.fillStyle = '#B4794A'; g.fill();
    g.strokeStyle = '#7E4F2A'; g.lineWidth = 3; g.stroke();
    rr(g, doorX + 5, dy + 6, doorW - 10, doorH * 0.4, 3);
    g.fillStyle = 'rgba(255,255,255,.16)'; g.fill();
    rr(g, doorX + 5, dy + doorH * 0.49, doorW - 10, doorH * 0.45, 3);
    g.fillStyle = 'rgba(0,0,0,.10)'; g.fill();
    g.fillStyle = '#FFD84D';
    g.beginPath(); g.arc(doorX + doorW - 5, dy + doorH * 0.52, 3.2, 0, 6.2832); g.fill();

    g.save();
    g.translate(CW - 16, dy - 34 * DECO); g.rotate(1.5708);
    rr(g, -34 * DECO, -11 * DECO, 68 * DECO, 22 * DECO, 5);
    g.fillStyle = '#2EC4B6'; g.fill();
    g.strokeStyle = '#1B8F84'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#FFFFFF';
    g.font = font(FD('task'), 800);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('出 口', 0, 0);
    g.restore();
  } else if (SCENE.decor === 'library') {
    drawRightLibrary(g);
  } else {
    drawRightCanteen(g);
  }

  /* ---- 后墙 ---- */
  g.fillStyle = PAL.wall;
  g.fillRect(0, CH - WALL_B, CW, WALL_B);
  g.strokeStyle = PAL.wallLine; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, CH - WALL_B + 1.5); g.lineTo(CW, CH - WALL_B + 1.5); g.stroke();

  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
}

/* ---------- 座位 ---------- */
/* ---------- 食堂餐桌（第九阶段 P2-5） ----------
 * 手册 §七 点名过：「不要把餐桌直接当座位复制」。原来食堂和教室共用同一套
 * 「椅子条 + 圆角矩形课桌 + 一条白色高光」，只换了配色和道具 emoji ——
 * 于是换个场景，玩家看到的还是那个教室，只是颜色暖了一点。
 *
 * 这里给食堂一套独立剪影，跟教室的方桌**在形状上**拉开：
 *   教室：长椅子条 + 方桌面 + 桌面高光条
 *   食堂：短圆凳 + 圆形桌面 + 桌沿厚度 + 一圈餐盘（特殊座位的道具图标正好落在盘子里）
 *
 * 为什么是「圆桌」而不是「方桌 + 两条长凳」：一格只有 36px（紧凑 28px），
 * 左右邻格紧挨着，横着放长凳一定会和邻桌叠在一起；圆桌的剪影在方阵里最省地方。
 *
 * ⚠️ 纯绘制分支：不消耗 Math.random，不写任何模拟状态。
 * ⚠️ 教室 / 图书馆不会走到这里（见 SCENES[].deskStyle），它们那条路径逐字未动。 */
/* 食堂圆桌的几何：**只有这一份**。绘制与回归断言共用同一个函数 ——
 * 各写一套的话，断言会一直绿到出事那天（见经验手册「抽成函数让绘制与断言共用」）。
 * top / bottom 是相对格子上沿的偏移，用来断言「圆桌整格装得下，不压下一行」。 */
function diningGeom() {
  var R = TILE * 0.42, cy = TILE * 0.58;
  return { R: R, cy: cy, top: cy - R, bottom: cy + R };
}

function drawDiningTable(g, c, r, fill, edge, lineWidth, lift) {
  var x = TX(c), y = TY(r) - (lift || 0);
  var cx = x + TILE / 2;
  /* 桌面半径 0.42 而不是 0.46：整片座位区有 36+ 张桌子，半径再大一点就变成
   * 「一片圆点」（实测过 0.46 那版，像气泡纸）。留出格间空隙，桌子才是一张张的。
   * 桌面中心 0.58 而不是 0.5：往下挪是为了把**圆凳露出来**。
   * 圆桌一旦居中，桌沿会把上方的凳子整个盖住 —— 每格就只剩两个同心圆，
   * 方阵里看过去全是圆。教室那套之所以好认，靠的正是「椅子条 + 方桌」两段式剪影。 */
  var geo = diningGeom();
  var R = geo.R, cy = y + geo.cy;
  var lw = lineWidth || 1.3;

  /* 圆凳（贴在桌子后方）：比教室的椅子条短一截，也是一眼能分辨的地方。
     ⚠️ 起点是 y+0.3 而不是负数 —— 第一行座位的 y 就是墙面带下沿（GY），
     往上探出去会在墙上留下一道凳子边的碎线。 */
  rr(g, cx - S36(7.5), y + S36(0.3), S36(15), S36(6.5), S36(3));
  g.fillStyle = PAL.chair; g.fill();
  g.strokeStyle = PAL.chairEdge; g.lineWidth = 1.2; g.stroke();

  /* 桌沿厚度：先画一块下沉的深色，再把亮面叠上去 —— 和课桌同一套 2.5D 手法 */
  rr(g, cx - R, cy - R + S36(2), R * 2, R * 2, R);
  g.fillStyle = edge; g.fill();

  /* 桌面 */
  rr(g, cx - R, cy - R, R * 2, R * 2, R);
  g.fillStyle = fill; g.fill();
  g.strokeStyle = lw > 1.5 ? edge : PAL.deskLine;
  g.lineWidth = lw;
  g.stroke();

  /* 餐盘：一圈**暖色**浅盘。
     ⚠️ 不能用白色：食堂桌面的 fill 本来就是 #FFF6E4（近白），白盘 + 描边
     在一整片座位里会变成 36 个「甜甜圈」，比原来的方桌还吵。
     用暖色低对比的圆盘才读得出「盘子里有东西」，又不会抢座位的视觉权重。
     特殊座位的道具 emoji 画在格心偏下（TY(r)+S36(19)），正好落在盘心 ——
     于是「盘子里摆着一个插座 / 一个皇冠」，不需要额外挪位置。 */
  g.beginPath();
  g.arc(cx, cy, R * 0.56, 0, Math.PI * 2);
  g.fillStyle = 'rgba(233,196,132,.30)'; g.fill();
  g.strokeStyle = 'rgba(196,158,98,.34)'; g.lineWidth = 1; g.stroke();

  /* 桌面高光：左上角一道弧（课桌是一条直条，圆桌用弧，剪影语言也统一） */
  g.save();
  g.strokeStyle = 'rgba(255,255,255,.60)';
  g.lineWidth = S36(2);
  g.lineCap = 'round';
  g.beginPath();
  g.arc(cx, cy, R * 0.80, Math.PI * 1.10, Math.PI * 1.45);
  g.stroke();
  g.restore();
}

function drawDesk(g, c, r, fill, edge, lineWidth, lift) {
  /* 食堂走圆桌那条路径（第九阶段 P2-5）。其余场景 deskStyle 不是 'dining'，
     连这个判断都不成立，逐字走下面原来那套。 */
  if (SCENE.deskStyle === 'dining') { drawDiningTable(g, c, r, fill, edge, lineWidth, lift); return; }

  var x = TX(c), y = TY(r) - (lift || 0);
  var dx = x + 3, dw = TILE - 6;

  /* 椅子（贴在桌子后方） */
  rr(g, x + 9, y + 1, TILE - 18, 8, 3);
  g.fillStyle = PAL.chair; g.fill();
  g.strokeStyle = PAL.chairEdge; g.lineWidth = 1.4; g.stroke();

  /* 桌面前沿（2.5D 厚度） */
  rr(g, dx, y + 10, dw, TILE - 13, 4);
  g.fillStyle = edge; g.fill();

  /* 桌面 */
  rr(g, dx, y + 9, dw, TILE - 16, 4);
  g.fillStyle = fill; g.fill();
  g.strokeStyle = lineWidth ? edge : PAL.deskLine;
  g.lineWidth = lineWidth || 1.3;
  g.stroke();

  /* 桌面高光 */
  rr(g, dx + 3, y + 12, dw - 6, 4, 2);
  g.fillStyle = 'rgba(255,255,255,.5)'; g.fill();
}

function drawAisleTile(g, c, r) {
  var x = TX(c), y = TY(r);
  var half = TILE / 2;

  /* 走道地面（比教室地板更浅更平整） */
  g.fillStyle = 'rgba(255,253,246,.86)';
  g.fillRect(x, y, TILE, TILE);
  g.fillStyle = 'rgba(214,190,146,.18)';
  g.fillRect(x, y, TILE, 1);
  g.fillRect(x, y, 1, TILE);

  /* 走道中线（6px 虚线，36px 一格刚好对齐） */
  g.save();
  g.strokeStyle = 'rgba(196,172,126,.55)';
  g.lineWidth = 2;
  g.setLineDash([6, 6]);
  g.beginPath();
  if (c % SCENE.aisle.colMod === SCENE.aisle.colOff) {
    g.moveTo(x + half, y); g.lineTo(x + half, y + TILE);
  }
  if (r % SCENE.aisle.rowMod === SCENE.aisle.rowOff) {
    g.moveTo(x, y + half); g.lineTo(x + TILE, y + half);
  }
  g.stroke();
  g.setLineDash([]);
  g.restore();
}

function drawEmptySeat(g, c, r) {
  var t = grid[I(c, r)];
  if (t.aisle) { drawAisleTile(g, c, r); return; }

  var def = SEAT[t.type];
  drawDesk(g, c, r, def.desk, def.edge, t.type === 'normal' ? 1.3 : 2.4, 0);

  if (t.type !== 'normal') {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = emojiFont(FS('ico'));
    g.globalAlpha = 0.94;
    g.fillText(def.icon, CX(c), TY(r) + S36(19));
    g.globalAlpha = 1;
  }
}

function drawAllEmptySeats(g) {
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) drawEmptySeat(g, c, r);
  }
}

/* ---------- 自己的占座路线：淡色发光路径 ----------
 * 单个座位发光只能表达「这是我的」，把相邻的同归属座位用光带连起来，
 * 才读得出「一条路线」。顺序：先连光带（在座位下面），再画座位本身。 */
function drawRouteGlow(g, time) {
  var i, t, c, r, ci, ri, col;
  /* V1.6 第一阶段：这里原来有一句「隐身期间整条路线不画」。
   * 它的前提是「路线被藏起来 = 技能生效」，可 V1.6 之后
   * **自己的占座本来就是所有人的通路**，把路线藏起来反而变成丢信息：
   * 玩家会以为自己的地盘没了，而它其实一直安全。
   * 所以现在无论 ghost 是否生效，自己的光带都照常画 ——
   * 「技能生效」改由 drawPlayerAura 的幽灵环 + 半透明表达（信息更准，也不丢状态提示）。 */

  g.save();
  g.lineCap = 'round';

  for (i = 0; i < grid.length; i++) {
    t = grid[i];
    if (!t.owner || !isHumanOwner(t.owner)) continue;
    ci = t.owner === 'p2' ? 1 : 0;
    col = ROUTE[ci];
    c = i % COLS; r = (i / COLS) | 0;
    /* 光带落在桌面前沿上，跟 2.5D 的视觉重心对齐 */
    var y = CY(r) + S36(6);

    g.strokeStyle = col;
    g.globalAlpha = 0.16 + 0.05 * Math.sin(time * 2.2 + (c + r) * 0.4);
    g.lineWidth = TILE * 0.4;

    /* 只连「右邻」和「下邻」，一条边只画一次 */
    if (c + 1 < COLS && grid[I(c + 1, r)].owner === t.owner) {
      g.beginPath();
      g.moveTo(CX(c), y); g.lineTo(CX(c + 1), y);
      g.stroke();
    }
    if (r + 1 < ROWS && grid[I(c, r + 1)].owner === t.owner) {
      g.beginPath();
      g.moveTo(CX(c), y); g.lineTo(CX(c), y + TILE);
      g.stroke();
    }
  }
  g.restore();
}

/* ---------- 学霸地图：把还没被占的高价值座位点亮 ----------
 * 手册第四阶段给学霸的招牌技能：「提前显示高价值座位」，优势「容易完成特殊座位任务」。
 * 这是**纯渲染**：只读 grid，不写任何模拟状态，也不消耗随机数 ——
 * 开着它和不开它，一局的走向完全一样，只是「看得见 / 看不见」的区别。
 *
 * 只标 score >= 40 的那几类（黄金后排 / 靠门位 / 插座位 / 空调位），
 * 老师眼皮底下那种负分座位不标 —— 手册说的「高价值」就是字面意思。
 * 数量约 20 出头，逐格描边 + 写分数的开销可以接受，而且只在技能生效的 8 秒里跑。 */
function drawMapHints(g, time) {
  var lit = [], hi, k, i, t, c, r, def;
  for (hi = 0; hi < humans.length; hi++) if (humans[hi].mapShow > 0) lit.push(hi);
  if (!lit.length) return;

  var pulse = 0.5 + 0.5 * Math.sin(time * 4.2);

  for (k = 0; k < lit.length; k++) {
    /* 用「深琥珀」而不是玩家路线的橙 —— 两者都落在座位上，
     * 颜色太近会让人以为那是自己的占座路线。深琥珀更像价签。
     * （第九阶段 P1-6：色值收进 TARGET_STYLE，理由见那张表的注释） */
    var col = TARGET_STYLE.ring;
    for (i = 0; i < grid.length; i++) {
      t = grid[i];
      if (t.owner || t.aisle) continue;
      def = SEAT[t.type];
      if (!def || def.score < 40) continue;
      c = i % COLS; r = (i / COLS) | 0;

      /* 阶段 8 追加：强标记（整格底色 + 双层描边 + 四角角标 + 分值药丸）。
         开关关掉 → 落到下面那段阶段 7 的原样绘制。 */
      if (SCHOLAR_SEAT_MARK_ON) { drawSpecialSeatMark(g, c, r, def, time); continue; }

      g.save();
      g.globalAlpha = 0.45 + 0.45 * pulse;
      g.strokeStyle = col;
      g.lineWidth = S36(3);
      rr(g, TX(c) + S36(3), TY(r) + S36(3), TILE - S36(6), TILE - S36(6), S36(7));
      g.stroke();

      g.globalAlpha = 0.78 + 0.22 * pulse;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = font(FS('sub'), 900);
      g.lineWidth = S36(3);
      g.strokeStyle = 'rgba(255,255,255,.88)';
      g.strokeText('+' + def.score, CX(c), CY(r) + S36(1));
      g.fillStyle = TARGET_STYLE.text;
      g.fillText('+' + def.score, CX(c), CY(r) + S36(1));
      g.restore();
    }
  }
}

/* 手册 十一、第十阶段「高价值座位视觉略加强」。
   最后 15 秒里，给**还没人占**的高价值座位（score >= 40）加一圈很淡的呼吸光环。
   ⚠️ 纯绘制：只读 grid，不写状态、不消耗随机数。
   比学霸地图的价签弱一档（没有 +分数 文字、透明度只有一半）——
   手册说的是「略加强」，它不能抢走玩家对角色前方的注意力。 */
function drawFinalRushHints(g, time) {
  if (!FINAL_RUSH_ON || !finalRush || state !== 'play') return;
  if (FINAL_RUSH_VERSUS_ONLY && !isVersus()) return;
  var pulse = 0.5 + 0.5 * Math.sin(time * 3.0);
  for (var i = 0; i < grid.length; i++) {
    var t = grid[i];
    if (t.owner || t.aisle) continue;
    var def = SEAT[t.type];
    if (!def || def.score < 40) continue;
    var c = i % COLS, r = (i / COLS) | 0;
    g.save();
    g.globalAlpha = 0.20 + 0.18 * pulse;
    g.strokeStyle = TARGET_STYLE.ring;
    g.lineWidth = S36(3);
    rr(g, TX(c) + S36(3), TY(r) + S36(3), TILE - S36(6), TILE - S36(6), S36(7));
    g.stroke();
    g.restore();
  }
}

/* ---------- 室友替占的持久记号（阶段 8 追加 R3，2026-10-21 晚）----------
 * 用户原话：「舍友帮忙的时候还存在着舍友占的座没有记号的问题」。
 *
 * 改前：室友替占只留 0.6 秒的扩散环（`helperMarks`），环一散就和玩家自己
 *   按出来的座位**完全一样** —— `t.owner` 都是玩家 id，配色 / 呼吸光晕 /
 *   路线光带全走同一套，事后没法分辨「哪几格是它帮我拿的」。
 *
 * 记号分两层，颜色沿用室友自己的青绿（`OWN_HELPER.edge`），和头顶倒计时药丸同色：
 *   ① **虚线内环**：虚线读作「别人帮你拿的」，与玩家自己的
 *      橙色**实心**呼吸光晕区分开 —— 光靠颜色区分不够，形状也要不同。
 *   ② **右下角小旗**：白底青绿框 + 🙋，一眼定位，不依赖颜色记忆。
 *      ⚠️ 2026-10-22 从**右上角**挪到右下角：右上角被「清理预告」的倒计时数字占了
 *         （见下面 ⚠️⚠️ 第 2 条），两个挤在同一格会互相盖。
 *
 * ⚠️ 纯绘制：只读 `t.hm`，不写任何状态、不消耗随机数。
 *
 * ⚠️⚠️ 必须走**雪碧图缓存**（`helperMarkSprite`），不能每帧现画：
 *   第一版是逐格 `setLineDash` + `fillText('🙋')`，23 格实测 **+1.956 ms/帧**
 *   （占 16.7ms 预算的 11.7%）—— 和 `itemSprites` 当初踩的是同一个坑：
 *   **每帧画 emoji + 虚线描边都很贵**。改成「一次性画进离屏 canvas，之后只
 *   drawImage」，代价落到噪声里。代价是虚线不再流动（静态图案）——
 *   记号要表达的是「这一格是室友拿的」，不靠动画表达，所以这个取舍是划算的。
 *   键 = `TILE|DPR|有没有环`：紧凑模式（TILE 28）与高分屏各有一份，
 *   有环 / 只有小旗各一份。
 *
 * ⚠️⚠️ **必须画在 `drawEventZones` 之后**（`drawHelperClaimMarks` 是独立一遍）：
 *   2026-10-22 用户报「第二次触发技能时，室友经过的座位有的还是没有标记」，
 *   截图一看就明白了 —— **不是没画，是被盖住了**：
 *   清理事件在开打前 3 秒会给每一格「待清座位」画 ①整格橙色填充 α.20~.36
 *   ②橙色虚线环（inset 1.5，lineWidth 3）③**右上角倒计时数字**。
 *   而这三样都画在 `drawEventZones` 里、**在座位层之后**，
 *   正好一层层压在我那圈青绿虚线（inset 2.5）和右上角小旗上。
 *   用户第一次放技能在开局（没有清理预告）→ 好好的；第二次在 22~27 秒
 *   （清理预告已经亮了）→ 一片「没标记」。**时序完全对得上。**
 *   所以现在：① 记号独立成一遍，排在事件层之后；② 小旗挪到右下角；
 *   ③ 该格已经在清理预告里时**只画小旗、不画环**（把橙色虚线环让出来，
 *      两个信号都不丢）。 */
var HELPER_MARK_SPR = {};

/* 这一格是不是正处在「清理预告」里（预告只亮 3 秒，之后要么被清掉、要么作废）。
 * 只为「让不让出虚线环」服务 —— 与计分、与 t.hm 都无关。 */
function helperInCleanPreview(i) {
  for (var k = 0; k < evCleanMark.length; k++) if (evCleanMark[k] === i) return true;
  return false;
}

function helperMarkSprite(withRing, fresh) {
  var key = TILE + '|' + DPR + '|' + (withRing ? 1 : 0) + '|' + (fresh ? 1 : 0);
  var sp = HELPER_MARK_SPR[key];
  if (sp) return sp;
  if (!document.createElement) return null;
  var size = TILE, cv;
  try { cv = document.createElement('canvas'); } catch (e) { return null; }
  if (!cv || !cv.getContext) return null;
  cv.width = Math.max(1, Math.round(size * DPR));
  cv.height = Math.max(1, Math.round(size * DPR));
  var g = cv.getContext('2d');
  if (!g) return null;
  if (g.setTransform) g.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (g.clearRect) g.clearRect(0, 0, size, size);

  /* ① 青绿虚线内环（清理预告期间不画，把位置让给橙色虚线环） */
  if (withRing) {
    var ins = S36(2.5), w = TILE - ins * 2;
    g.strokeStyle = '#1B7A63';
    g.lineWidth = S36(2.2);
    g.setLineDash([S36(4), S36(3)]);
    rr(g, ins, ins, w, w, S36(6));
    g.stroke();
    g.setLineDash([]);
  }

  /* ② 右下角小旗：白底青绿框 + 室友那个 🙋。
     ⚠️ 第一版写的是白字「帮」（10px / weight 900）—— 放大 4 倍一看，
        汉字笔画在那个尺寸下**糊成一坨白斑**，等于没写。改成室友自己身上
        那个 🙋（游戏里已经用它标记室友），形状一眼能认、颜色也一致。
     阶段 8 追加 R3.2（`fresh` = 刚经过的那 0.6 秒）：底色换成浅青绿 + 加一圈外描边。
       只改**颜色**、不改尺寸 —— 尺寸一变，玩家会以为「这一格是什么别的东西」。
       按 `TILE|DPR|环|fresh` 缓存，所以四种组合各一份，仍然是 drawImage 一次。 */
  var bw = S36(15), bh = S36(15);
  var bx = TILE - bw - S36(2), by = TILE - bh - S36(2);
  rr(g, bx, by, bw, bh, S36(4));
  if (fresh) {
    g.fillStyle = '#D7F5EC'; g.fill();
    g.lineWidth = S36(2.6); g.strokeStyle = 'rgba(27,122,99,.42)'; g.stroke();   /* 外描边 = “刚点亮” */
    g.lineWidth = S36(1.6); g.strokeStyle = '#1B7A63'; g.stroke();
  } else {
    g.fillStyle = '#FFFFFF'; g.fill();
    g.lineWidth = S36(1.6); g.strokeStyle = '#1B7A63'; g.stroke();
  }

  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = emojiFont(FS('hud'));
  g.fillText('🙋', bx + bw / 2, by + bh / 2 + S36(0.5));

  sp = { canvas: cv, size: size };
  HELPER_MARK_SPR[key] = sp;
  return sp;
}

/* 独立的一遍：只扫 `t.hm` 的格子。排在 `drawEventZones` / `drawSceneOverlays`
 * 之后、`drawEntities` 之前 —— 压住清理预告，但仍在角色下面。 */
function drawHelperClaimMarks(g) {
  if (!ROOMIE_MARK_ON) return;
  /* 阶段 8 追加 R3.2：`t.hm` 的值从 1 改成 2（见 claimTile）。这里**不读值**，
     只读真假 —— 「非 0」= 室友拿的。这样即使将来再加一档，这里也不用改。 */
  for (var i = 0; i < grid.length; i++) {
    var t = grid[i];
    if (!t.hm || !t.owner) continue;
    var c = i % COLS, r = (i / COLS) | 0;
    var sp = helperMarkSprite(!helperInCleanPreview(i), !!t.hmh);
    if (!sp) continue;
    g.drawImage(sp.canvas, TX(c), TY(r), sp.size, sp.size);
  }
}

function drawSeatDynamic(g, c, r, t, time) {
  var def = SEAT[t.type];
  /* 人类玩家的座位用原配色（高亮），NPC 用降饱和配色（退到背景） */
  var own = ownPalette(t.owner);
  if (!own) return;

  var lift = t.anim > 0 ? Math.sin(t.anim * Math.PI) * 4 : 0;

  /* 人类玩家的占座：外圈一层缓慢呼吸的柔光，让「我的路线」自己会亮。
   * V1.6 第一阶段起**不再随 ghost 隐藏**（理由见 drawRouteGlow 的注释）——
   * 自己的地盘永远安全，就该永远看得见。 */
  if (isHumanOwner(t.owner)) {
    var ri = t.owner === 'p2' ? 1 : 0;
    g.save();
    g.globalAlpha = 0.15 + 0.07 * Math.sin(time * 2.6 + (c + r) * 0.55);
    g.strokeStyle = ROUTE[ri];
    g.lineWidth = S36(7);
    rr(g, TX(c) - S36(3), TY(r) - S36(3), TILE + S36(6), TILE + S36(6), S36(10));
    g.stroke();
    g.restore();
  }

  /* 脉冲光环 */
  if (t.anim > 0 || t.claimAge < 0.45) {
    var a = t.anim;
    g.save();
    g.globalAlpha = a * 0.5;
    g.strokeStyle = own.edge;
    g.lineWidth = 3;
    rr(g, TX(c) - 2 - a * 5, TY(r) - 2 - a * 5, TILE + 4 + a * 10, TILE + 4 + a * 10, 8);
    g.stroke();
    g.restore();
  }

  drawDesk(g, c, r, own.desk, own.edge, 2.4, lift);

  /* 物品小托盘 */
  g.save();
  g.globalAlpha = 0.9;
  if (SCENE.deskStyle === 'dining') {
    /* 食堂：托盘就是那只盘子。方托盘压在圆桌上会变成「靶心」——
     * 圆桌 + 圆盘 + 盘中一个道具，才是食堂该有的读法（P2-5）。 */
    g.beginPath();
    g.arc(CX(c), TY(r) + S36(20) - lift, S36(8.5), 0, Math.PI * 2);
    g.fillStyle = own.item; g.fill();
  } else {
    rr(g, CX(c) - S36(9), TY(r) + S36(12) - lift, S36(18), S36(16), 4);
    g.fillStyle = own.item; g.fill();
  }
  g.restore();

  var sp = itemSprites[t.item];
  if (sp) {
    g.drawImage(sp.canvas, CX(c) - sp.size / 2, TY(r) + S36(20) - lift - sp.size / 2,
      sp.size, sp.size);
  } else {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = emojiFont(FS('ico'));
    g.fillText(t.item, CX(c), TY(r) + S36(20) - lift);
  }

  /* 特殊座位的类型角标 */
  if (t.type !== 'normal') {
    g.font = emojiFont(FS('tag'));
    g.globalAlpha = 0.9;
    g.fillText(def.icon, TX(c) + S36(8), TY(r) + S36(12) - lift);
    g.globalAlpha = 1;
  }

  /* ⚠️ 阶段 8 追加 R3.1（2026-10-22）：室友记号**不再画在这里**。
     座位层排在 `drawEventZones` 之前，而清理预告（整格橙填充 + 橙虚线环 +
     右上角倒计时数字）画在事件层里 → 会把记号整个盖掉。用户报的「第二次放技能
     有的没标记」就是这个。记号已独立成 `drawHelperClaimMarks(g)`，排在事件层之后。 */
}

function drawPulses(g, time) {
  for (var i = 0; i < grid.length; i++) {
    var t = grid[i];
    if (t.owner || t.type === 'normal') continue;
    var c = i % COLS, r = (i / COLS) | 0;
    var ph = (Math.sin(time * 3.4 + i * 0.7) + 1) / 2;
    var def = SEAT[t.type];
    g.save();
    g.globalAlpha = 0.20 + ph * 0.45;
    g.strokeStyle = def.edge;
    g.lineWidth = 2.4;
    rr(g, TX(c) - 1 - ph * 3, TY(r) - 1 - ph * 3, TILE + 2 + ph * 6, TILE + 2 + ph * 6, 7);
    g.stroke();

    /* 被「看这里」点名的座位：额外一圈向外扩散的光环，替代原来的横幅提示 */
    if (i === hintTile && hintT > 0) {
      var k = 1 - hintT / 3.0;
      var ex = k * TILE * 0.85;
      g.globalAlpha = (1 - k) * 0.85;
      g.lineWidth = S36(3.4) * (1 - k * 0.5);
      rr(g, TX(c) - 2 - ex, TY(r) - 2 - ex, TILE + 4 + ex * 2, TILE + 4 + ex * 2, S36(8) + ex);
      g.stroke();
    }
    g.restore();
  }
}

function drawContests(g, time) {
  for (var i = 0; i < grid.length; i++) {
    var t = grid[i];
    var alpha = Math.max(t.contest ? t.contestT : 0, t.vsMark > 0 ? Math.min(1, t.vsMark * 1.6) : 0);
    if (alpha <= 0.01) continue;
    var c = i % COLS, r = (i / COLS) | 0;
    var x = CX(c), y = Math.max(TY(r) - S36(14), GY + S36(32));
    var s = 0.8 + 0.2 * Math.sin(time * DANGER_STYLE.blink.clash * Math.PI);
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.globalAlpha = alpha;
    rr(g, -21, -15, 42, 26, 9);
    /* 第九阶段 P1-6：这里原本是 #FF4D4D —— 与老师视野的 #E5342B 是同一个语义
       （「这一格有危险」）却用了两种红。统一成 DANGER_STYLE.red。
       「有争端」和「踩了会死」在玩家眼里本来就是同一件事：别往那走。 */
    g.fillStyle = DANGER_STYLE.red; g.fill();
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 2.4; g.stroke();
    g.beginPath();
    g.moveTo(-6, 10); g.lineTo(0, 17); g.lineTo(6, 10);
    g.closePath();
    g.fillStyle = DANGER_STYLE.red; g.fill();
    g.fillStyle = '#FFFFFF';
    g.font = font(FS('warn'), 900);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('抢！', 0, -2);
    g.restore();
  }
}

/* ---------- 角色 ---------- */
function drawChar(g, x, y, own, bob, face, isPlayer) {
  var yy = y - bob * 3;
  var k = TILE / 36;

  g.save();
  if (k !== 1) { g.translate(x, y); g.scale(k, k); g.translate(-x, -y); }

  /* 白色描边光晕，保证角色在彩色桌面上也能一眼看清。
   * 强度由配色表决定：人类玩家 9，NPC 2.5 —— 这是「高亮 / 弱化」最省钱的开关。 */
  g.shadowColor = 'rgba(255,255,255,.95)';
  g.shadowBlur = own.glow || (isPlayer ? 7 : 4);
  g.shadowOffsetX = 0;
  g.shadowOffsetY = 0;

  /* 影子 */
  g.fillStyle = 'rgba(90,70,40,.20)';
  g.beginPath();
  g.ellipse(x, y + 11, 12, 4.5, 0, 0, 6.2832);
  g.fill();

  /* 书包 */
  rr(g, x - 9, yy + 3, 18, 11, 4);
  g.fillStyle = isPlayer ? '#F2A03D' : '#E9E4DA';
  g.fill();
  g.strokeStyle = own.edge; g.lineWidth = 1.8; g.stroke();

  /* 身体 */
  rr(g, x - 11, yy - 4, 22, 16, 8);
  g.fillStyle = own.body; g.fill();
  g.strokeStyle = own.edge; g.lineWidth = 2.2; g.stroke();

  /* 衣领 */
  g.beginPath();
  g.moveTo(x - 4, yy - 4); g.lineTo(x, yy + 1); g.lineTo(x + 4, yy - 4);
  g.fillStyle = own.body2; g.fill();

  g.shadowBlur = 0;

  /* 头 */
  g.beginPath();
  g.arc(x, yy - 11, 8.6, 0, 6.2832);
  g.fillStyle = '#FFE1C4'; g.fill();
  g.strokeStyle = own.edge; g.lineWidth = 2; g.stroke();

  /* 头发 */
  g.beginPath();
  g.arc(x, yy - 12.5, 8.6, Math.PI * 1.06, Math.PI * 1.94);
  g.lineTo(x + 8, yy - 9);
  g.lineTo(x - 8, yy - 9);
  g.closePath();
  g.fillStyle = isPlayer ? '#3A2E26' : own.edge;
  g.fill();

  /* 眼睛 */
  var ex = face * 1.8;
  g.fillStyle = '#3A2E26';
  g.beginPath(); g.arc(x - 3.1 + ex, yy - 10, 1.5, 0, 6.2832); g.fill();
  g.beginPath(); g.arc(x + 3.1 + ex, yy - 10, 1.5, 0, 6.2832); g.fill();

  /* 腮红 */
  g.fillStyle = 'rgba(255,140,120,.45)';
  g.beginPath(); g.arc(x - 6 + ex, yy - 7.5, 1.9, 0, 6.2832); g.fill();
  g.beginPath(); g.arc(x + 6 + ex, yy - 7.5, 1.9, 0, 6.2832); g.fill();

  g.restore();
}

function drawBubble(g, x, y, text) {
  g.font = font(FS('hud'), 800);
  var w = g.measureText(text).width + 22;
  var h = 27;
  x = clamp(x, w / 2 + 8, CW - w / 2 - 8);
  y = Math.max(y, h + 8);
  rr(g, x - w / 2, y - h, w, h, 9);
  g.fillStyle = '#FFFFFF'; g.fill();
  g.strokeStyle = PAL.ink; g.lineWidth = 2.2; g.stroke();
  g.beginPath();
  g.moveTo(x - 6, y - 1); g.lineTo(x, y + 7); g.lineTo(x + 6, y - 1);
  g.closePath();
  g.fillStyle = '#FFFFFF'; g.fill();
  g.strokeStyle = PAL.ink; g.lineWidth = 2.2; g.stroke();
  g.fillStyle = PAL.ink;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x, y - h / 2);
}

/* ---------- 玩家光环 ----------
 * 黄/蓝双色环 + 柔光底盘。双环反向旋转，静止时也有呼吸感，
 * 保证玩家在任何一帧都是场景里最亮的东西。 */
function drawPlayerAura(g, hu, i, time) {
  var x = CX(hu.c), y = TY(hu.r) + S36(4);
  var col = AURA[i] || AURA[0];
  var R = TILE * 0.78;
  var ph = time * 1.6 + i * 2.1;

  g.save();

  /* 柔光底盘：中心稍亮、边缘透明，把玩家从背景里「托」起来 */
  var grd = g.createRadialGradient(x, y, R * 0.12, x, y, R * 1.18);
  grd.addColorStop(0, hexA(col.glow, 0.34));
  grd.addColorStop(0.58, hexA(col.glow, 0.15));
  grd.addColorStop(1, hexA(col.glow, 0));
  g.fillStyle = grd;
  g.beginPath();
  g.arc(x, y, R * 1.18, 0, 6.2832);
  g.fill();

  /* 外环：金黄，顺时针转 */
  var r1 = R * (0.98 + 0.045 * Math.sin(ph * 2));
  g.globalAlpha = 0.92;
  g.strokeStyle = col.ring;
  g.lineWidth = S36(3.2);
  g.setLineDash([S36(9), S36(7)]);
  g.lineDashOffset = -ph * 15;
  g.beginPath();
  g.arc(x, y, r1, 0, 6.2832);
  g.stroke();

  /* 内环：蓝色，逆时针转 —— 双色环就是手册说的「黄色/蓝色圆环」 */
  g.globalAlpha = 0.78;
  g.strokeStyle = col.ring2;
  g.lineWidth = S36(2.1);
  g.lineDashOffset = ph * 19;
  g.beginPath();
  g.arc(x, y, r1 * 0.74, 0, 6.2832);
  g.stroke();

  /* V1.6 第一阶段：惩罚性碰撞的两个状态提示。
   * 这两段是纯渲染 —— 只读 hu.penalty / hu.invuln，不写任何模拟字段、不掷骰子，
   * 所以加进来对整局随机序列零影响。
   * 必须让玩家一眼读懂，否则他会以为「按键坏了」而不是「我被罚了」。 */
  if (hu.penalty > 0) {
    /* ① 复位等待：外圈压一道红环 + 正下方一个倒计时数字。
     *   取 ceil，所以显示的是「还剩几秒」——2.0 显示 2、1，归零的那一帧立刻复位。
     *   ⚠️ 数字必须画在**环外下方**：光环是最底层（drawEntities 里先画光环、
     *   再画朝向箭头、最后画人物本体），写在格子正中会被人物身体整个盖住 ——
     *   第一版就是写正中的，截出来只看得见红环，数字一个像素都没露。 */
    g.setLineDash([]);
    g.globalAlpha = 0.72 + 0.28 * Math.sin(time * 9);
    g.strokeStyle = DANGER_STYLE.red;
    g.lineWidth = S36(3.6);
    g.beginPath();
    g.arc(x, y, r1 * 1.14, 0, 6.2832);
    g.stroke();

    g.globalAlpha = 1;
    g.font = font(FS('warn'), 900);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    var secs = String(Math.ceil(hu.penalty));
    var sy = y + r1 * 1.62;                  /* 环外下方，避开人物本体与 🎒 */
    g.lineWidth = S36(DANGER_STYLE.stroke.heavy);
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.strokeText(secs, x, sy);
    g.fillStyle = DANGER_STYLE.red;
    g.fillText(secs, x, sy);
  } else if (hu.invuln > 0) {
    /* ② 复位落地保护期：一圈白色快速呼吸环 ——
     *   「这段时间里再撞也不会被罚」，玩家要能感觉到自己有一段缓冲。 */
    g.setLineDash([]);
    g.globalAlpha = 0.35 + 0.45 * Math.sin(time * 16);
    g.strokeStyle = '#FFFFFF';
    g.lineWidth = S36(4.2);
    g.beginPath();
    g.arc(x, y, r1 * 1.22, 0, 6.2832);
    g.stroke();
  }

  /* ③ V1.6 第一阶段：把「老师来了」的状态画在玩家身上。
   * 原来这个状态是靠「自己的占座路线整条消失」表达的，可 V1.6 之后
   * 自己的座位本来就是所有人的通路，路线再藏起来只会让玩家以为地盘丢了。
   * 所以改成玩家自己身上一圈青绿幽灵虚线环 —— 状态提示没少，信息还更准。
   * （半透明那一条仍然由 drawEntities 里的 globalAlpha 负责） */
  if (hu.ghost > 0) {
    g.setLineDash([S36(6), S36(6)]);
    g.lineDashOffset = -time * 30;
    g.globalAlpha = 0.45 + 0.35 * Math.sin(time * 7);
    g.strokeStyle = '#7FE0C8';
    g.lineWidth = S36(3.6);
    g.beginPath();
    g.arc(x, y, r1 * 1.30, 0, 6.2832);
    g.stroke();
    g.setLineDash([]);
  }

  /* ④ 阶段 8 修（2026-10-20 用户试玩反馈 R4 行动派）：
   *   「最好在这个技能结束前也有提示，或者在有这个技能的时候给占座小人后面有个火焰的背景」。
   *
   *   改前：`dash` **只改速度**（`actorStepMs` 里 ms *= 0.72），画面上一个像素都没变 ——
   *   玩家根本不知道自己还在加速、更不知道什么时候结束。
   *   改后：背后三层火焰拖尾（黄 → 橙 → 深红，带一点抖动）+ 最后 1 秒一圈橙色闪烁环。
   *   纯渲染：只读 `hu.dash` / `hu.dir`，不写模拟字段、不掷骰子。
   *   拖尾画在**朝向的反方向**，所以一眼能看出「在往哪边冲」。 */
  if (hu.dash > 0 && hu.dir) {
    var ddx = hu.dir.dx, ddy = hu.dir.dy;
    var ppx = -ddy, ppy = ddx;                  /* 朝向的左手法线 */
    var fadeD = Math.min(1, hu.dash / 0.7);     /* 最后 0.7 秒整体收掉，消失不突兀 */

    /* ① 暖色光晕（脉动）—— 让火焰在奶油色地板上也能被一眼看到 */
    g.globalAlpha = (0.15 + 0.06 * Math.sin(time * 13)) * fadeD;
    g.fillStyle = '#FF8A2B';
    g.beginPath();
    g.arc(x - ddx * r1 * 0.55, y - ddy * r1 * 0.55, r1 * 1.55, 0, 6.2832);
    g.fill();

    /* ② 火舌：**横向错开**成左 / 中 / 右三束，而不是叠在同一条轴上。
       叠在一条轴上只会得到一个尖锥（看起来像箭头）；错开才有「火」的形状。
       外→内四层（深红 → 橙 → 亮黄），内层更窄更短，正好是火焰的剖面。
       每束的底边在**靠近玩家那一侧向内收**（`ddx*wid*0.45`），
       于是底边是个凹口 —— 火焰特有的形状，而不是实心三角。 */
    var LAY = [
      { off: -0.56, len: 1.55, wid: 0.50, col: '#E23B0B', a: 0.55, ph: 0.0 },
      { off:  0.58, len: 1.42, wid: 0.46, col: '#E23B0B', a: 0.55, ph: 2.6 },
      { off:  0.02, len: 1.78, wid: 0.58, col: '#FF7A18', a: 0.78, ph: 1.7 },
      { off:  0.00, len: 1.08, wid: 0.28, col: '#FFE066', a: 0.90, ph: 4.4 }
    ];
    for (var dfi = 0; dfi < LAY.length; dfi++) {
      var L = LAY[dfi];
      var flick = 0.80 + 0.20 * Math.sin(time * 23 + L.ph);          /* 长度跳动 */
      var wob = Math.sin(time * 19 + L.ph * 1.7) * S36(1.8);         /* 左右摇曳 */
      var lat = L.off * r1 + wob;
      var back = r1 * (0.30 + dfi * 0.05);
      var dlen = r1 * L.len * flick;
      var dwid = r1 * L.wid;
      var bx = x - ddx * back + ppx * lat;
      var by = y - ddy * back + ppy * lat;
      g.globalAlpha = L.a * fadeD;
      g.fillStyle = L.col;
      g.beginPath();
      g.moveTo(bx - ddx * dlen, by - ddy * dlen);                    /* 火苗尖朝后 */
      g.lineTo(bx + ppx * dwid, by + ppy * dwid);
      g.lineTo(bx + ddx * dwid * 0.45, by + ddy * dwid * 0.45);      /* 底边凹口 */
      g.lineTo(bx - ppx * dwid, by - ppy * dwid);
      g.closePath();
      g.fill();
    }

    /* ③ 结束前 1 秒：橙色闪烁环 —— 「冲刺要没了，别再指望它」 */
    if (hu.dash <= 1.0) {
      g.globalAlpha = 0.42 + 0.42 * Math.sin(time * 18);
      g.strokeStyle = '#FF7A18';
      g.lineWidth = S36(3.4);
      g.beginPath();
      g.arc(x, y, r1 * 1.24, 0, 6.2832);
      g.stroke();
    }
  }

  g.setLineDash([]);
  g.restore();
}

/* ---------- 下一步方向提示 ----------
 * 两件事一起做：
 *   1. 玩家正前方一个朝向箭头（跟着当前朝向旋转）
 *   2. 目标格上虚线圈 —— 危险（会撞到别人的占座路线）时变红
 * 手册验收标准里的「危险路线明显」就是靠第 2 点落地的。
 * V1.6 第一阶段起「危险」只剩一种来源：**别人的座位**。
 * 单人踩上去直接出局，双人扣 50 分 + 复位 2 秒 —— 都值得提前预警。 */
function drawStepHint(g, hu, i, time) {
  if (!hu.alive) return;                 /* 出局了就别再提示方向了 */
  /* 复位等待期间不接受输入，箭头指哪儿都是假的 —— 索性不画，
   * 让 drawPlayerAura 那个倒计时数字独占画面。 */
  if (hu.penalty > 0) return;

  /* 关键：优先用「当前按住的输入」而不是 hu.dir。
   * hu.dir 只在 tryMovePlayer 里更新，而那是每 130ms 才走一次的 ——
   * 直接读它，箭头会比手指慢半拍，危险预警也会指错格子。
   * 输入为空时才退回 hu.dir，当作「朝向」用。 */
  var pressed = actorInputDir(hu);
  var moving = !!pressed;
  var d = pressed || hu.dir;
  if (!d) return;
  var col = AURA[i] || AURA[0];

  var nc = hu.c + d.dx, nr = hu.r + d.dy;
  var hx = CX(hu.c), hy = TY(hu.r) + S36(4);

  /* 这一格踩下去会不会撞车。
   * V1.6 第一阶段起口径简化成一条：**只有「别人的座位」才算危险**。
   *   ① 自己的座位 = 自己的通路，永远安全（原来要靠 ghost 生效才安全，
   *      所以「别撞自己的占座路线」这条老提示现在彻底作废）；
   *   ② 后果分两种但提示同一种：单人是直接出局，双人是扣 50 分 + 复位 2 秒。
   * 箭头和虚线圈共用这个判断 —— 箭头本身也要跟着变红。 */
  var onBoard = inB(nc, nr);
  var tgtOwner = onBoard ? grid[I(nc, nr)].owner : null;
  var danger = moving && onBoard && !!tgtOwner && tgtOwner !== hu.id;

  /* ---- 目标格虚线圈 ----
   * 只在「真的按着方向键」时出现：危险提示是对玩家意图的回应，
   * 不做成常驻的装饰，否则满屏闪烁反而变成新的噪音。 */
  if (moving && onBoard) {
    var t = grid[I(nc, nr)];
    var box = danger ? DANGER_STYLE.red
      : (!t.aisle && t.type !== 'normal' ? SEAT[t.type].edge : col.ring2);
    g.save();
    g.globalAlpha = danger ? 0.62 + 0.33 * Math.sin(time * DANGER_STYLE.blink.near) : 0.55;
    g.strokeStyle = box;
    g.lineWidth = S36(danger ? DANGER_STYLE.stroke.mid : 2.2);
    g.setLineDash([S36(5), S36(4)]);
    g.lineDashOffset = -time * 26;
    rr(g, TX(nc) + S36(2), TY(nr) + S36(2), TILE - S36(4), TILE - S36(4), S36(7));
    g.stroke();
    g.setLineDash([]);
    if (danger) {
      /* 后果分两种，所以文案也跟着分：
       *   V1.5（`SOLO_PENALTY_ON` 关）—— 单人踩到别人的占座路线**直接出局**，只写「撞车」；
       *   单人开 / 双人 —— 扣 50 分 + 复位 2 秒，把代价直接写在脸上，玩家才知道值不值得硬闯。
       * D（2026-10-04）把单人也统一成惩罚性碰撞之后，两种模式的后果一样了，
       * 所以这里改判**开关**而不是 `isVersus()` —— 否则单人玩家看不到代价，
       * 「同一个动作在两种模式里后果不同」这条问题只解决了一半（提示还在骗人）。
       * 位置沿前进方向挪到格子外面 —— 箭头变红变大之后已经占满整个格子，
       * 文字留在格子里只会跟箭头糊在一起。 */
      var warnText = (isVersus() || SOLO_PENALTY_ON) ? ('撞车 -' + PENALTY_SCORE) : '撞车';
      g.globalAlpha = 0.78 + 0.22 * Math.sin(time * DANGER_STYLE.blink.near);
      g.font = font(FS('task'), 900);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      var lx = CX(nc) + d.dx * S36(24);
      var ly = TY(nr) + S36(18) + d.dy * S36(24);
      g.lineWidth = S36(DANGER_STYLE.stroke.heavy);
      g.strokeStyle = 'rgba(255,255,255,.92)';
      g.strokeText(warnText, lx, ly);
      g.fillStyle = DANGER_STYLE.red;
      g.fillText(warnText, lx, ly);
    }
    g.restore();
  }

  /* ---- 朝向箭头：贴在玩家正前方 ----
   * V1.5 加强（原来只有 S36(7.2) 的小三角 + 1.8px 白边，在浅木纹底上糊成一团）：
   *   · 加大到 S36(9.4)，外圈半径推到 TILE 让箭头整只落在光环外面
   *   · 深色粗描边（背景是浅色，描边比填充更决定可读性）
   *   · 白色外发光，深色/浅色背景都能抠出来
   *   · 撞车时整只箭头变红并加快闪烁，不用再去看地上的字
   *   · 松手后的「朝向」状态从 0.4 提到 0.62，站着不动也看得见朝向 */
  var rad = TILE;
  var ax = hx + d.dx * rad;
  var ay = hy + d.dy * rad;
  /* 尺寸按「格子的百分比」给，而不是 S36 —— 紧凑版格子只有 28px，
   * 用 S36 换算出来的箭头在手机上偏小，方向指示反而更难看清。 */
  var s = TILE * 0.30 * (moving ? 1 + 0.09 * Math.sin(time * 8) : 0.86);
  var pulse = moving ? 1 : 0.62;

  g.save();
  g.globalAlpha = danger ? 0.82 + 0.18 * Math.sin(time * 12) : pulse;
  g.translate(ax, ay);
  g.rotate(Math.atan2(d.dy, d.dx));
  g.lineJoin = 'round';
  /* 箭头形状要「胖」：早先那版两臂太细，描边一粗就把填充吃光了，
   * 手机上只剩一个深色空壳。现在臂厚约 0.7s，描边再粗也留得住金色。 */
  g.beginPath();
  g.moveTo(s * 1.16, 0);
  g.lineTo(-s * 0.74, -s * 1.04);
  g.lineTo(-s * 0.28, 0);
  g.lineTo(-s * 0.74, s * 1.04);
  g.closePath();

  /* 白色外发光：浅色木纹底上作用有限，但深色座垫上能托一把 */
  g.shadowColor = 'rgba(255,255,255,.95)';
  g.shadowBlur = S36(moving ? 8 : 5);
  g.fillStyle = danger ? DANGER_STYLE.red : col.ring;
  g.fill();
  g.shadowBlur = 0;

  /* 深色描边决定可读性 —— 背景是浅色，纯金色箭头对比度不够 */
  g.strokeStyle = '#3A322A';
  g.lineWidth = S36(2.9);
  g.stroke();

  g.restore();
}

function drawEntities(g, time) {
  var i, n;
  for (i = 0; i < npcs.length; i++) {
    n = npcs[i];
    /* NPC 用降饱和配色 + 弱光晕，视觉权重明显低于玩家 */
    var nOwn = OWN_DIM[n.id] || OWN[n.id];
    drawChar(g, CX(n.c), TY(n.r) + S36(4), nOwn, n.bob, n.dir.dx, false);

    /* 人设 emoji 徽章（同样压暗，别跟玩家抢注意力） */
    g.save();
    g.globalAlpha = 0.72;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = emojiFont(FS('ico'));
    g.fillText(n.emoji, CX(n.c) + S36(11), TY(n.r) - S36(8));
    g.restore();

    if (n.blocked) {
      g.save();
      g.globalAlpha = 0.7;
      g.font = font(FS('sub'), 800);
      g.fillStyle = 'rgba(80,70,60,.65)';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('坐下了', CX(n.c), TY(n.r) + S36(30));
      g.restore();
    }
  }

  /* 人类玩家：单人 1 个、双人 2 个，都画在最上层
   * （i = 0 时的相位与 V1 完全一致，单人画面不会变） */
  for (i = 0; i < humans.length; i++) {
    if (demo) break;
    var hu = humans[i];
    var hx = CX(hu.c), hy = TY(hu.r);
    var hOwn = OWN[hu.id] || OWN.player;

    /* 「老师来了」：整个玩家（光环 / 箭头 / 本体 / 书包）压成半透明，
     * 一眼就能看出「我现在是隐身状态」。这里用一层 save/restore 统一压，
     * 下面几个绘制函数内部各自的 save 会继承当前 alpha。 */
    g.save();
    if (hu.ghost > 0) g.globalAlpha = 0.42;

    /* 1. 光环（最底层） */
    drawPlayerAura(g, hu, i, time);

    /* 2. 目标格虚线圈 + 朝向箭头（在人物下面，别挡住脸） */
    drawStepHint(g, hu, i, time);

    /* 3. 人物本体 */
    drawChar(g, hx, hy + S36(4), hOwn, hu.bob, hu.dir.dx, true);

    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = emojiFont(FS('ico'));
    g.fillText('🎒', hx + S36(12), hy - S36(9));

    g.restore();
  }

  /* 室友刚占下的格子：一圈**向外扩散**的环（0.6 秒）。
     「扩散」而不是「收缩」—— 扩散读起来是「这一格刚刚被拿下了」，
     收缩看起来像「有个东西缩没了」，玩家反而会以为是自己丢了座。
     和下面那个「室友」本体分开画 —— 本体会走，环必须留在被占的那一格上。 */
  for (i = 0; i < helperMarks.length; i++) {
    var mk = helperMarks[i];
    var mkA = Math.max(0, mk.t / 0.6);              /* 1 → 0 */
    var mkx = CX(mk.c), mky = CY(mk.r);
    g.save();
    g.globalAlpha = 0.9 * mkA;
    g.strokeStyle = '#2FA8C9';
    g.lineWidth = S36(3.6) * (0.35 + mkA * 0.65);
    var mkR = TILE * (0.86 + 0.54 * (1 - mkA));     /* 0.86 → 1.40 格，往外炸开 */
    /* ⚠️ CX/CY 返回的已经是**格子中心**，这里不能再补 TILE/2 ——
       补了就整圈下移半格，看起来像「隔壁那一格被占了」。 */
    rr(g, mkx - mkR / 2, mky - mkR / 2, mkR, mkR, S36(9));
    g.stroke();
    g.restore();
  }

  /* 室友：社交达人召来的跟班。画在玩家下面、气泡上面 —— 它只是个小配角，
   * 不该抢玩家的视觉焦点。快到期时淡出，消失得不突兀。 */
  for (i = 0; i < helpers.length; i++) {
    var hp = helpers[i];
    var px = CX(hp.c), py = TY(hp.r) + S36(4);
    g.save();
    if (hp.t < 2) g.globalAlpha = Math.max(0, hp.t / 2);
    drawChar(g, px, py, OWN_HELPER, hp.bob, hp.dir.dx, false);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = emojiFont(FS('task'));
    g.fillText('🙋', px + S36(11), py - S36(12));
    g.restore();

    /* 阶段 8 修（用户反馈「舍友消失前几秒应有倒计时提示」）：
       剩 3 秒起在头顶画一个圆底数字（3 / 2 / 1），最后 1 秒变红并轻微跳动。
       **不写 emoji、不混字体栈** —— 只画数字，避免中文与 emoji 两套字体出方框。
       ⚠️ 高度必须抬到 py-40：飘分（室友替占的 +25）画在 py-26 附近，而且
          drawFloats 在 drawEntities **之后**跑 —— 放低了会被那串红字整个盖住。 */
    /* 阶段 8 追加（用户反馈「舍友一出来，就触发他消失的倒计时」）：
       从出生起就画一颗「剩 N 秒」的药丸，最后 1.2 秒变红并轻微跳动。
       ⚠️ 药丸比原来的圆底数字宽，必须抬到 py-52：
          ① 飘分（室友替占的 +25）在 py-26，且 drawFloats 在 drawEntities **之后**跑；
          ② 技能飘字（「没地方站了」等）在 py-42、称号横幅也在那一带
             → 药丸压在 -52 才不会被它们盖住（第一版放 -44，正好卡在 -42 的飘字上）。
       关掉 ROOMIE_TIMER_ON → cdw 恒为 null → 走下面的老分支（最后 3 秒的圆底数字）。 */
    var cdw = helperCountdown(hp);
    if (cdw) {
      var cdBob = cdw.urg ? Math.sin(time * 18) * S36(1.8) : 0;
      var cdTxt = '剩 ' + cdw.n + ' 秒';
      var cdCx = px, cdCy = py - S36(52) + cdBob;
      g.save();
      g.globalAlpha = Math.min(1, ((hp.t0 || ROOMIE_HELP_DUR) - hp.t) / 0.25 + 0.35) *
                      Math.min(1, hp.t / 0.35) *
                      (cdw.urg ? (0.72 + 0.28 * Math.sin(time * 16)) : 1);
      g.font = font(FS('fS'), 900);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      /* 宽度只在「秒数变了」时量一次。每帧 measureText 是这段最大的开销
         （实测把这一组的单帧净增从 0.03 顶到 1.0ms）。 */
      if (hp.cdWKey !== cdw.n) {
        hp.cdW = g.measureText(cdTxt).width;
        hp.cdWKey = cdw.n;
      }
      var cdH = S36(17), cdW = hp.cdW + S36(15);
      g.fillStyle = cdw.urg ? '#D9480F' : '#0B6B62';
      rr(g, cdCx - cdW / 2, cdCy - cdH / 2, cdW, cdH, cdH / 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,.92)';
      g.lineWidth = S36(1.5);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = '#FFFFFF';
      g.fillText(cdTxt, cdCx, cdCy + S36(0.5));
      g.restore();
    } else if (hp.t <= 3) {
      var leftS = Math.max(1, Math.ceil(hp.t));
      var urg = hp.t <= 1.2;
      var bobY = urg ? Math.sin(time * 18) * S36(1.8) : 0;
      var bx2 = px, by2 = py - S36(40) + bobY;
      var br2 = S36(10.5);
      g.save();
      g.globalAlpha = Math.min(1, hp.t / 0.6) * (urg ? (0.7 + 0.3 * Math.sin(time * 16)) : 0.92);
      g.fillStyle = urg ? '#D9480F' : '#0B6B62';
      g.beginPath();
      g.arc(bx2, by2, br2, 0, 6.2832);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,.9)';
      g.lineWidth = S36(1.6);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = '#FFFFFF';
      g.font = font(FS('fS'), 900);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(leftS), bx2, by2 + S36(0.5));
      g.restore();
    }

    /* ⚠️ 开场气泡和「剩 N 秒」药丸抢同一片空域（都在头顶往上）——
     * 开着倒计时就让掉气泡：倒计时信息量更大，而且「室友来了！」的飘字还在玩家脚下。
     * 关掉倒计时 → 气泡照旧。 */
    if (hp.bubble > 0 && !ROOMIE_TIMER_ON) {
      g.save();
      g.globalAlpha = Math.min(1, hp.bubble) * 0.95;
      /* 气泡比 NPC 的再抬高一点：室友头顶还有一个 🙋 徽章，不抬会把它盖住 */
      drawBubble(g, px, Math.max(py - S36(24), GY + S36(34)), '我来帮你占！');
      g.restore();
    }
  }

  /* 气泡最后画，保证在最上层 */
  for (i = 0; i < npcs.length; i++) {
    n = npcs[i];
    if (n.bubble > 0 && n.bubbleText) {
      g.save();
      g.globalAlpha = Math.min(1, n.bubble) * 0.9;
      drawBubble(g, CX(n.c), Math.max(TY(n.r) - S36(12), GY + S36(34)), n.bubbleText);
      g.restore();
    }
  }
}

function drawParticles(g, big) {
  var i, p;
  for (i = 0; i < parts.length; i++) {
    p = parts[i];
    if ((p.size > 3.4) !== big) continue;
    var a = clamp(p.life / p.max, 0, 1);
    g.save();
    g.globalAlpha = a;
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.fillStyle = p.color;
    if (p.star) {
      g.beginPath();
      for (var k = 0; k < 5; k++) {
        var ang = (k / 5) * 6.2832 - 1.5708;
        g.lineTo(Math.cos(ang) * p.size, Math.sin(ang) * p.size);
        var ang2 = ang + 0.6283;
        g.lineTo(Math.cos(ang2) * p.size * 0.45, Math.sin(ang2) * p.size * 0.45);
      }
      g.closePath(); g.fill();
    } else {
      g.beginPath();
      g.arc(0, 0, p.size, 0, 6.2832);
      g.fill();
    }
    g.restore();
  }
}

function drawFloats(g) {
  var i, f;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (i = 0; i < floats.length; i++) {
    f = floats[i];
    /* V1.5：普通占座的飘分被标记为 mute —— 只在 HUD 上体现，不往画面里堆 */
    if (f.cls === 'mute') continue;
    var a = clamp(f.life / f.max, 0, 1);
    var pop = f.life > f.max - 0.12 ? 1 + (f.max - f.life) * 3 : 1;
    g.save();
    g.globalAlpha = Math.min(1, a * 1.6);
    g.translate(f.x, f.y);
    g.scale(pop, pop);
    g.font = font(f.size, 900);
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,255,255,.95)';
    g.strokeText(f.text, 0, 0);
    g.fillStyle = f.color;
    g.fillText(f.text, 0, 0);
    g.restore();
  }
}

function drawBanners(g, time) {
  var i, b;
  for (i = 0; i < banners.length; i++) {
    b = banners[i];
    /* V1.6 第三阶段（手册 §九）：尺寸与几何全部问 bannerBox()，
       大号（白名单内：管理员清理 / 任务完成 / 最后 15 秒 / 开场结束）保持原样，
       小号（其余）缩小 + 去掉底板 —— 内容不丢，只是不再占用「大型中央提示」。 */
    var bx = bannerBox(b);
    var idx = i - (banners.length - 1);
    var a = clamp(b.life / b.max, 0, 1);
    var t = 1 - b.life / b.max;
    var pop = t < 0.16 ? 0.7 + (t / 0.16) * 0.34 : 1 + Math.sin(t * 12) * 0.012;
    var y = WALL_T + bx.top * DECO + idx * bx.step;

    g.save();
    g.globalAlpha = Math.min(1, a * 2.2) * bx.alpha;
    g.translate(CW / 2, y);
    g.scale(pop, pop);

    var main = b.text;
    var sub = b.sub || '';
    g.font = font(bx.font1, 900);
    var w1 = g.measureText(main).width;
    g.font = font(bx.font2m, 700);
    var w2 = sub ? g.measureText(sub).width : 0;
    var w = Math.max(w1 + bx.pad1, w2 + bx.pad2, bx.minW);
    var h = bx.h;

    if (bx.plate) {
      rr(g, -w / 2 + 4, -h / 2 + 5, w, h, bx.r);
      g.fillStyle = 'rgba(46,42,38,.22)'; g.fill();
    }
    rr(g, -w / 2, -h / 2, w, h, bx.r);
    g.fillStyle = bx.quiet ? 'rgba(255,255,255,.74)'
      : (b.kind === 'bad' ? '#FFE1E1' : (b.kind === 'milestone' ? '#FFF0BF' : '#FFFFFF'));
    g.fill();
    g.strokeStyle = bx.quiet ? 'rgba(46,42,38,.30)' : PAL.ink;
    g.lineWidth = bx.lw; g.stroke();

    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (b.emoji) {
      g.font = emojiFont(bx.font1);
      g.fillText(b.emoji, -w / 2 + bx.emojiDx, sub ? bx.textDy : 0);
    }
    /* 里程碑横幅的琥珀是「奖励」语义，与学霸地图的目标提示只是恰好同色，
       不要合并 —— 语义不同，将来改一个不该牵动另一个。 */
    g.fillStyle = b.kind === 'bad' ? DANGER_STYLE.text : (b.kind === 'milestone' ? '#8A5A00' : '#1B3A5C');
    g.font = font(bx.font1, 900);
    g.fillText(main, bx.textDx, sub ? bx.textDy : 0);
    if (sub) {
      g.fillStyle = PAL.ink2;
      g.font = font(bx.font2, 700);
      g.fillText(sub, bx.textDx, bx.subDy);
    }
    g.restore();
  }
}

/* ---------- 事件区域：安全区 / 老师视野 / 清理涟漪 ----------
 * 全部画在「座位之上、角色之下」，保证角色永远在最上层不被盖住。 */
function drawEventZones(g, time) {
  var i, e = evActive;

  /* V1.6 第二阶段：待清理预告。
     管理员到点前 EV_CLEAN_WARN 秒，把这一轮**真的要清掉的那些格子**圈出来 ——
     圈的就是待会儿执行时用的那份名单（evCleanPlan.cells），不是另算一遍，
     所以「预告」和「实际」永远是同一批格子。

     画在座位之上、人物之下（drawEventZones 在 render 里的位置正好）：
     不会被自己的角色盖住，也不会盖住角色。
     用矢量描边 + 斜纹而不是 emoji —— @napi-rs/canvas 没有 emoji 字体，
     「哪些座位要没了」这种关键信号不能只靠一个 🧹。 */
  /* 阶段 2：整片区域的大虚线框。逐格描边只能说明「这些格子要没了」，
     说不清「这是一片」—— 加一个包围整个清理窗口的外框，玩家一眼就知道该往哪边赶。
     框只画在 `evCleanPlan.box` 上（1C 从窗口外补的那一两格不参与），
     呼吸节奏比逐格慢一半，避免和逐格的闪烁打架。 */
  /* 阶段 7：学霸的提前预判（弱提示）。
     **故意比正式预告弱一档**：正式框是「奶油色打底 + 深橙压线」的实线 + 每格倒计时；
     这里用紫色、只给一个总的倒计时 —— 让学霸「早点知道往哪边走」，
     而不是「提前拿到同样的信息量」。
     ⚠️ 2026-10-20 用户试玩反馈：「我**看到**那个紫色虚线框了吗？—— 否，提示太弱」
     「提前 7 秒有没有真的帮我规划路线？—— 没有，太不明显了」。
     所以强度整体上调，但**保持「弱于正式框」这个前提**：
       ① 加极淡填充 —— 先让「这一片」成为一个面，而不是几条边；
       ② 改成「奶油白打底 + 紫线压上去」的双层描边（正式框用的是同一个手法，
          单层紫虚线在深色座位和橙格子上几乎看不见，这正是「太弱」的根因）；
       ③ 虚线走起来（lineDashOffset 跟着时间跑）—— 会动的东西才抓得住眼睛；
       ④ 标签从 8px 小字换成紫底白字药丸，并**带上实时倒计时**「N 秒后清理」，
          直接回答「它出现时我知道它是下一片要清的地方吗」。

     🆕 R3.4（2026-10-22 用户：「加一个能提前看到下一轮清理座位的功能，
        但是保留当前特殊座位高光亮起的功能」）：
        上一版只有一个大框 —— 玩家知道「清这一片」，但不知道「清哪几个座位」。
        现在框还在（回答「哪一片」），框里再**逐格点亮每一张会被清的桌子**
        （回答「哪几格」）。两层画法都刻意跟「学霸地图」区分开：
          学霸地图（技能）：琥珀色、实心、有「+100」分值药丸  → 该去抢的
          清理预判（被动）：紫色、描边 + 淡底、无分值        → 马上要没的
        语义相反的两件事不能长得像，否则玩家会去抢一个马上要被清掉的座位。
        ⚠️ 自己踩着的那格画成「空心虚线」—— 它到时候会被跳过（手册 §七），
          不能让我以为自己脚下也保不住。 */
  if (evCleanPeek && evCleanPeek.box) {
    var pkc = evCleanPeek.box.c0, pkr = evCleanPeek.box.r0;
    var pkx = TX(pkc), pky = TY(pkr);
    var pkw = TILE * EV_CLEAN_CLUSTER_W, pkh = TILE * EV_CLEAN_CLUSTER_H;
    var pkph = (Math.sin(time * 2.2) + 1) / 2;
    var pkLeft = Math.max(1, Math.ceil(evCleanPeek.at - elapsed));
    g.save();
    /* ① 极淡紫色填充：只到「看得出这是一片」，不压过正式框的橙 */
    g.globalAlpha = 0.09 + pkph * 0.05;
    g.fillStyle = '#8B6BE8';
    rr(g, pkx + S36(4), pky + S36(4), pkw - S36(8), pkh - S36(8), S36(14));
    g.fill();
    /* ② 双层虚线：白底 + 紫线 */
    g.globalAlpha = 0.5 + pkph * 0.25;
    g.strokeStyle = '#FFF7EC';
    g.lineWidth = S36(6.5);
    if (g.setLineDash) g.setLineDash([S36(13), S36(9)]);
    g.lineDashOffset = -time * 22;
    rr(g, pkx + S36(5), pky + S36(5), pkw - S36(10), pkh - S36(10), S36(14));
    g.stroke();
    g.globalAlpha = 0.82 + pkph * 0.18;
    g.strokeStyle = '#5B3FB0';
    g.lineWidth = S36(3.4);
    rr(g, pkx + S36(5), pky + S36(5), pkw - S36(10), pkh - S36(10), S36(14));
    g.stroke();
    if (g.setLineDash) g.setLineDash([]);
    g.lineDashOffset = 0;
    /* ③ 标签药丸：紫底白字 + 倒计时 */
    var pkLabel = '学霸预判 · ' + pkLeft + ' 秒后清理';
    g.font = font(FS('fS'), 900);
    var pkw2 = g.measureText(pkLabel).width + S36(20);
    var pkh2 = S36(19);
    var pkbx = pkx + S36(5), pkby = pky - S36(5) - pkh2;
    if (pkby < GY + S36(2)) pkby = pky + S36(8);   /* 贴到顶边就翻到框里面 */
    g.globalAlpha = 0.92;
    g.fillStyle = '#5B3FB0';
    rr(g, pkbx, pkby, pkw2, pkh2, S36(9.5));
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#FFFFFF';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(pkLabel, pkbx + S36(10), pkby + pkh2 / 2 + S36(0.5));
    g.restore();

    /* ④ R3.4：框内逐格点亮「会被清的每一个座位」。
       画在大框之后再 restore 一次 —— 大框的虚线是「区域」，格标是「内容」，
       格标若先画，后画的大框粗白线会压掉紧贴边上的那些格子的一部分。
       配色：淡紫底 + 紫描边 + 中间一个小圆点（不用 emoji，@napi-rs/canvas 没有 emoji 字体）。
       自己脚下那格 → 画成**空心虚线**（到时候会被跳过）。 */
    if (evCleanPeek.cells && evCleanPeek.cells.length) {
      var feet = null;
      if (EV_CLEAN_SKIP_FEET) feet = evFeetSet();
      var cw = TILE - S36(6);
      var cellPulse = 0.5 + 0.5 * Math.sin(time * 3.4);
      for (var ci = 0; ci < evCleanPeek.cells.length; ci++) {
        var cIdx = evCleanPeek.cells[ci];
        var cc2 = cIdx % COLS, rr2 = (cIdx / COLS) | 0;
        var cx0 = TX(cc2) + S36(3), cy0 = TY(rr2) + S36(3);
        var underFoot = !!(feet && feet[cIdx]);
        g.save();
        if (underFoot) {
          /* 空心虚线：我站在这儿，这格到时候不清 */
          g.globalAlpha = 0.55 + cellPulse * 0.25;
          g.strokeStyle = '#5B3FB0';
          g.lineWidth = S36(2.4);
          if (g.setLineDash) g.setLineDash([S36(5), S36(4)]);
          rr(g, cx0, cy0, cw, cw, S36(7));
          g.stroke();
          if (g.setLineDash) g.setLineDash([]);
        } else {
          /* 淡紫底 → 让这张桌子从地图里「浮」起来 */
          g.globalAlpha = 0.14 + cellPulse * 0.10;
          g.fillStyle = '#8B6BE8';
          rr(g, cx0, cy0, cw, cw, S36(7));
          g.fill();
          /* 白底 + 紫线双层描边（和强标记同一手法，任何座位底色上都有一条能看的边） */
          g.globalAlpha = 0.9;
          g.strokeStyle = '#FFFFFF';
          g.lineWidth = S36(5.0);
          rr(g, cx0, cy0, cw, cw, S36(7));
          g.stroke();
          g.globalAlpha = 0.9 + cellPulse * 0.1;
          g.strokeStyle = '#5B3FB0';
          g.lineWidth = S36(2.6);
          rr(g, cx0, cy0, cw, cw, S36(7));
          g.stroke();
          /* 中心小圆点：远处也能看出「这格被标了」 */
          g.globalAlpha = 0.5 + cellPulse * 0.35;
          g.fillStyle = '#5B3FB0';
          g.beginPath();
          g.arc(CX(cc2), CY(rr2), S36(3.2), 0, Math.PI * 2, false);
          g.fill();
        }
        g.restore();
      }
    }
  }

  if (evCleanPlan && evCleanPlan.box) {
    var bxc = evCleanPlan.box.c0, bxr = evCleanPlan.box.r0;
    var bpx = TX(bxc), bpy = TY(bxr);
    var bpw = TILE * EV_CLEAN_CLUSTER_W, bph = TILE * EV_CLEAN_CLUSTER_H;
    var bph2 = (Math.sin(time * 3) + 1) / 2;
    /* ⚠️ 双层描边，不是装饰 —— 单层橙色实线会**和逐格的橙色填充同色**，
       在满屏橙格子上根本看不出边界（第一版就是这样，截图上完全找不到框）。
       先用奶油色粗线打底、再压一条深橙细线：任何底色上都有一道高对比的边。 */
    g.save();
    g.globalAlpha = 0.5 + bph2 * 0.3;
    g.strokeStyle = '#FFF7EC';
    g.lineWidth = S36(7);
    rr(g, bpx + S36(3), bpy + S36(3), bpw - S36(6), bph - S36(6), S36(14));
    g.stroke();
    g.globalAlpha = 0.8 + bph2 * 0.2;
    g.strokeStyle = '#C2410C';
    g.lineWidth = S36(3.5);
    rr(g, bpx + S36(3), bpy + S36(3), bpw - S36(6), bph - S36(6), S36(14));
    g.stroke();
    g.restore();
  }

  for (i = 0; i < evCleanMark.length; i++) {
    var mi = evCleanMark[i];
    if (mi < 0 || mi >= grid.length) continue;
    if (!grid[mi].owner) continue;             /* 这 3 秒里已经被清掉了，不再圈 */
    var mc = mi % COLS, mr = (mi / COLS) | 0;
    var mph = (Math.sin(time * 6) + 1) / 2;
    var mx = TX(mc), my = TY(mr);
    g.save();
    g.globalAlpha = 0.20 + mph * 0.16;
    g.fillStyle = '#FF7A2E';
    rr(g, mx, my, TILE, TILE, S36(8));
    g.fill();
    g.globalAlpha = 0.75 + mph * 0.25;
    g.strokeStyle = '#FF7A2E';
    g.lineWidth = S36(3);
    if (g.setLineDash) g.setLineDash([S36(6), S36(4)]);
    rr(g, mx + S36(1.5), my + S36(1.5), TILE - S36(3), TILE - S36(3), S36(8));
    g.stroke();
    if (g.setLineDash) g.setLineDash([]);
    /* 右上角一个倒计时数字 —— 一眼知道还剩几秒，不用去数顶上的时钟 */
    if (evCleanPlan) {
      var sec = Math.max(1, Math.ceil(evCleanPlan.at - elapsed));
      g.globalAlpha = 1;
      g.font = font(FS('fS'), 900);
      g.textAlign = 'right';
      g.textBaseline = 'top';
      g.lineWidth = S36(3.2);
      g.strokeStyle = 'rgba(70,30,0,.85)';
      g.strokeText(String(sec), mx + TILE - S36(3), my + S36(2));
      g.fillStyle = '#FFE0BC';
      g.fillText(String(sec), mx + TILE - S36(3), my + S36(2));
    }
    g.restore();
  }

  /* 管理员清理：一圈向外扩散的水波纹 */
  for (i = 0; i < evFx.length; i++) {
    var f = evFx[i];
    var k = 1 - f.t / f.max;
    var ex = k * TILE * 0.8;
    g.save();
    g.globalAlpha = (1 - k) * 0.85;
    g.strokeStyle = f.col || '#7FB2D9';
    g.lineWidth = S36(3.2) * (1 - k * 0.6);
    rr(g, f.x - TILE / 2 - ex, f.y - TILE / 2 - ex, TILE + ex * 2, TILE + ex * 2, S36(9));
    g.stroke();
    g.restore();
  }

  if (!e) return;

  if (e.kind === 'roll') {
    var ph = (Math.sin(time * 5) + 1) / 2;

    g.save();
    g.globalAlpha = 0.15 + ph * 0.10;
    g.fillStyle = '#3FBF6A';
    rr(g, TX(e.c - 1), TY(e.r - 1), TILE * 3, TILE * 3, S36(14));
    g.fill();
    g.globalAlpha = 0.72 + ph * 0.28;
    g.strokeStyle = '#2E9E52';
    g.lineWidth = S36(3.4);
    rr(g, TX(e.c - 1) + 1, TY(e.r - 1) + 1, TILE * 3 - 2, TILE * 3 - 2, S36(14));
    g.stroke();
    g.restore();

    /* 从玩家到安全区的虚线指引：只有 10 秒，方向必须一眼看得出来。
       双人模式下给两个人各画一条，用颜色区分谁是谁。 */
    for (var hi = 0; hi < humans.length; hi++) {
      var hh = humans[hi];
      if (!hh.alive) continue;
      g.save();
      g.globalAlpha = 0.42 + 0.22 * Math.sin(time * 6);
      g.strokeStyle = hi === 0 ? '#2E9E52' : '#2E7BE5';
      g.lineWidth = S36(3);
      g.setLineDash([S36(8), S36(7)]);
      g.lineDashOffset = -time * S36(28);
      g.beginPath();
      g.moveTo(CX(hh.c), CY(hh.r));
      g.lineTo(CX(e.c), CY(e.r));
      g.stroke();
      g.setLineDash([]);
      g.restore();
    }

    /* 中心信标 */
    g.save();
    g.globalAlpha = 0.92;
    g.fillStyle = '#2E9E52';
    g.beginPath();
    g.arc(CX(e.c), CY(e.r), TILE * (0.28 + 0.10 * ph), 0, 6.2832);
    g.fill();
    g.strokeStyle = '#FFFFFF';
    g.lineWidth = S36(2.4);
    g.stroke();
    g.restore();
  }

  if (e.kind === 'patrol') {
    var px = GX + e.c * TILE + TILE / 2, py = CY(e.r);
    var rad = e.rad * TILE;
    g.save();
    /* 渐变的三档透明度写死在这里，颜色从 DANGER_STYLE 取 ——
       手抄 'rgba(229,52,43,…)' 三次，改色时漏一处就花了。 */
    var dRgb = DANGER_STYLE.redRgb;
    var rg = g.createRadialGradient(px, py, rad * 0.12, px, py, rad);
    rg.addColorStop(0, 'rgba(' + dRgb + ',.38)');
    rg.addColorStop(0.60, 'rgba(' + dRgb + ',.20)');
    rg.addColorStop(1, 'rgba(' + dRgb + ',0)');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(px, py, rad, 0, 6.2832);
    g.fill();
    g.globalAlpha = 0.62 + 0.24 * Math.sin(time * DANGER_STYLE.blink.zone);
    g.strokeStyle = DANGER_STYLE.red;
    g.lineWidth = S36(DANGER_STYLE.stroke.mid);
    g.setLineDash([S36(10), S36(8)]);
    g.lineDashOffset = time * S36(34);
    g.beginPath();
    g.arc(px, py, rad, 0, 6.2832);
    g.stroke();
    g.setLineDash([]);
    g.restore();
  }

  /* V2 第六节：老师提前进教室 —— 前排两排铺红斜纹危险区。
     斜纹比纯色块更「像警告」，也不会把座位本身盖住看不清。 */
  if (e.kind === 'early') {
    var erows = e.rows || EV_EARLY_ROWS;
    var bandY = TY(0), bandH = erows * TILE, bandW = COLS * TILE;
    var beat = (Math.sin(time * DANGER_STYLE.blink.zone) + 1) / 2;

    g.save();
    g.beginPath();
    rr(g, GX, bandY, bandW, bandH, S36(6));
    g.clip();

    g.globalAlpha = 0.12 + beat * 0.08;
    g.fillStyle = DANGER_STYLE.red;
    g.fillRect(GX, bandY, bandW, bandH);

    /* 斜纹：从左上往右下扫，整体缓慢流动，一眼看出是「警戒区」而不是脏东西 */
    g.globalAlpha = 0.20 + beat * 0.10;
    g.strokeStyle = DANGER_STYLE.red;
    g.lineWidth = S36(6);
    var drift = (time * S36(26)) % S36(30);
    for (var sx = -bandH - S36(30); sx < bandW + S36(30); sx += S36(30)) {
      g.beginPath();
      g.moveTo(GX + sx + drift, bandY);
      g.lineTo(GX + sx + drift + bandH, bandY + bandH);
      g.stroke();
    }
    g.restore();

    /* 危险区的下边界，让「排到哪儿为止」有明确的线 */
    g.save();
    g.globalAlpha = 0.60 + beat * 0.30;
    g.strokeStyle = DANGER_STYLE.red;
    g.lineWidth = S36(DANGER_STYLE.stroke.bold);
    g.setLineDash([S36(12), S36(9)]);
    g.lineDashOffset = -time * S36(30);
    g.beginPath();
    g.moveTo(GX, bandY + bandH);
    g.lineTo(GX + bandW, bandY + bandH);
    g.stroke();
    g.setLineDash([]);
    g.restore();
  }
}

/* ---------- 事件角色与倒计时胶囊（画在角色之上） ---------- */
/* 全场事件在画布底部正中的胶囊文案：kind → [前缀, 底色]。
 * 用一张表而不是一长串三元表达式 —— 加事件时只改这里，不会再漏掉某一支。
 * ⚠️ 前缀里不能放 emoji（胶囊用 font() 画，没有 emoji 字体）。 */
var EV_CAPSULE = {
  canteen: ['食堂开饭 ', '#2E9E52'],
  exam: ['期末周狂暴 ', DANGER_STYLE.red],
  finalweek: ['期末周 ', DANGER_STYLE.red],
  bell: ['开饭铃 ', '#D9622B'],
  newdish: ['新菜 ', '#C98A1E']
};

function drawEventActors(g, time) {
  var e = evActive;
  if (!e) return;
  var bx, by, label, col;

  if (e.kind === 'roll') {
    bx = CX(e.c); by = TY(e.r) - S36(12);
    label = '剩余 ' + Math.max(0, Math.ceil(e.t)) + 's';
    col = '#2E9E52';
  } else if (e.kind === 'patrol') {
    bx = GX + e.c * TILE + TILE / 2;
    by = CY(e.r) - S36(20);
    label = '剩余 ' + Math.max(0, Math.ceil(e.t)) + 's';
    col = DANGER_STYLE.red;
    g.save();
    g.font = emojiFont(FS('bigIco'));
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(255,255,255,.95)';
    g.shadowBlur = S36(9);
    g.fillText('👨‍🏫', bx, CY(e.r) + S36(3));
    g.restore();
  } else if (e.kind === 'roommate') {
    /* 室友的求助气泡单独画，不去动 Actor 自己的气泡系统 ——
     * 改 Actor 的气泡计时会推迟 pick(lines) 的随机数消耗，整局走位就跑偏了 */
    var who = e.who;
    if (who) {
      var txt = '帮我占四个连座！';
      g.save();
      g.font = font(FS('hud'), 800);
      var w = g.measureText(txt).width + S36(22);
      var h = S36(27);
      var x = clamp(CX(who.c), w / 2 + 8, CW - w / 2 - 8);
      var y = Math.max(TY(who.r) - S36(14), h + 8);
      rr(g, x - w / 2, y - h, w, h, S36(9));
      g.fillStyle = '#FFF6D8'; g.fill();
      g.strokeStyle = '#C98A1E'; g.lineWidth = S36(2.4); g.stroke();
      g.beginPath();
      g.moveTo(x - S36(6), y - 1); g.lineTo(x, y + S36(7)); g.lineTo(x + S36(6), y - 1);
      g.closePath();
      g.fillStyle = '#FFF6D8'; g.fill();
      g.strokeStyle = '#C98A1E'; g.lineWidth = S36(2.4); g.stroke();
      g.fillStyle = '#7B4B00';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt, x, y - h / 2);
      g.restore();
    }
    return;
  } else if (e.kind === 'early') {
    /* 老师站在前排危险区里，胶囊挂在危险区**下边界下方**。
       ⚠️ 位置要避开画面顶部中央：事件横幅就挂在那儿，两者叠在一起谁也看不清。
       所以老师放危险区左端，胶囊放危险区下方中央。 */
    var er = e.rows || EV_EARLY_ROWS;
    bx = CX(Math.floor(COLS / 2));
    by = TY(er) + S36(26);
    label = '前排危险 · 剩余 ' + Math.max(0, Math.ceil(e.t)) + 's';
    col = DANGER_STYLE.red;
    g.save();
    g.font = emojiFont(FS('bigIco'));
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(255,255,255,.95)';
    g.shadowBlur = S36(10);
    g.fillText('👨‍🏫', CX(Math.floor(COLS * 0.16)), CY(er / 2 - 0.5));
    g.restore();
  } else if (EV_CAPSULE[e.kind]) {
    /* 这几个都是全场事件、没有空间位置，胶囊挂画布底部正中 ——
       底部只有 20~26px 的墙，不会挡到任何座位。
       ⚠️ label 里**不要放 emoji**：胶囊用的是 font()（含中文不含 emoji），
       放进去只会渲染成一个方框。emoji 交给横幅去表达。 */
    var cap = EV_CAPSULE[e.kind];
    bx = CW / 2;
    by = CH - S36(6);
    label = cap[0] + Math.max(0, Math.ceil(e.t)) + 's';
    col = cap[1];
  } else {
    return;
  }

  g.save();
  g.font = font(FS('hud'), 900);
  var w2 = g.measureText(label).width + S36(18);
  var h2 = S36(21);
  g.globalAlpha = 0.96;
  rr(g, bx - w2 / 2, by - h2, w2, h2, h2 / 2);
  g.fillStyle = col; g.fill();
  g.strokeStyle = '#FFFFFF'; g.lineWidth = S36(1.8); g.stroke();
  g.fillStyle = '#FFFFFF';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, bx, by - h2 / 2);
  g.restore();
}

/* ---------- 局部放大相机 ----------
 * 把镜头对准 humans[0]，clamp 在地图范围内（靠近边缘时镜头停住，不露黑边）。
 * 纯渲染辅助，不读不改任何模拟状态、不消耗随机数。 */
function updateCamera() {
  var vw = CW / ZOOM, vh = CH / ZOOM;
  var tx = CW / 2, ty = CH / 2;
  if (humans.length) { var p = humans[0]; tx = CX(p.c); ty = CY(p.r); }
  var maxX = Math.max(0, CW - vw), maxY = Math.max(0, CH - vh);
  var tcx = Math.max(0, Math.min(maxX, tx - vw / 2));
  var tcy = Math.max(0, Math.min(maxY, ty - vh / 2));
  if (!camReady) { camX = tcx; camY = tcy; camReady = true; }
  else { camX += (tcx - camX) * 0.18; camY += (tcy - camY) * 0.18; }
}

/* 当前校园事件的安全区在放大视野外时，在屏幕边缘画个箭头指方向（绿 = 安全区色）。 */
function drawOffscreenArrow(ctx, time) {
  if (!evActive || evActive.c == null) return;
  var ox = CX(evActive.c), oy = CY(evActive.r);
  var vw = CW / ZOOM, vh = CH / ZOOM;
  if (ox >= camX && ox <= camX + vw && oy >= camY && oy <= camY + vh) return;
  var sx = (ox - camX) * ZOOM, sy = (oy - camY) * ZOOM;
  var cx = CW / 2, cy = CH / 2;
  var ang = Math.atan2(sy - cy, sx - cx);
  var ex = cx + Math.cos(ang) * (CW / 2 - 46);
  var ey = cy + Math.sin(ang) * (CH / 2 - 46);
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(ang);
  ctx.fillStyle = 'rgba(46,158,82,0.92)';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-10, 11); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
  if (humans.length) {
    var p = humans[0];
    var dist = Math.round(Math.abs(ox - CX(p.c)) + Math.abs(oy - CY(p.r)));
    ctx.save();
    ctx.fillStyle = 'rgba(46,158,82,0.95)';
    ctx.font = '600 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(dist + ' 格', ex, ey + 26);
    ctx.restore();
  }
}

/* ---------- 场景专属叠加层 ----------
 * 图书馆：把安静区涂成半透明冷色 + 上下虚线边界 + 一行「安静区 · 禁止冲刺」
 * 食堂：在每个热门位上画一个跳动的小火苗
 * 教室：两者都为空 → 整个函数是一次空循环（零开销、零随机消耗） */
/* ---------- 图书馆三个区域的可视化（第六阶段） ----------
 * 三个区域必须**一眼分得清**，否则玩家不知道站哪儿划得来：
 *   插座区    左侧竖带 + 琥珀色实线框（插座位只长在这里，稀缺）
 *   小组讨论区 底部横带 + 绿色虚线（占座额外加分 + 出额外任务）
 *   安静区    沿用下面原有的冷蓝底 + 上下虚线，标签补上「高分 / 慢行」
 * 全是纯矢量，不依赖 emoji 字体。教室/食堂第一行就返回。 */
function drawLibZones(g) {
  if (!libOn()) return;
  /* 插座区 */
  var pcMax = libPlugColMax();
  var px0 = TX(1), px1 = TX(pcMax + 1);
  var py0 = TY(1), py1 = TY(ROWS - 1);
  g.save();
  g.fillStyle = 'rgba(240,178,40,.11)';
  g.fillRect(px0, py0, px1 - px0, py1 - py0);
  g.strokeStyle = 'rgba(206,142,16,.55)';
  g.lineWidth = 2;
  g.strokeRect(px0 + 1, py0 + 1, px1 - px0 - 2, py1 - py0 - 2);
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = font(FS('task'), 800);
  g.fillStyle = 'rgba(150,96,10,.9)';
  g.fillText('插座区 · 一位难求', px0 + 6, py0 + 14);
  g.restore();

  /* 小组讨论区 */
  var gy0 = TY(libGroupRowMin()), gy1 = TY(ROWS);
  g.save();
  g.fillStyle = 'rgba(60,170,110,.12)';
  g.fillRect(WALL_L, gy0, COLS * TILE, gy1 - gy0);
  g.strokeStyle = 'rgba(38,140,86,.5)';
  g.lineWidth = 2;
  g.setLineDash([9, 7]);
  g.beginPath();
  g.moveTo(WALL_L, gy0 + 0.5); g.lineTo(WALL_L + COLS * TILE, gy0 + 0.5);
  g.stroke();
  g.setLineDash([]);
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = font(FS('hud'), 800);
  g.fillStyle = 'rgba(30,120,74,.85)';
  g.fillText('小组讨论区 · 额外任务', WALL_L + 8, gy0 + 14);
  g.restore();
}

/* ---------- 安静值仪表 ----------
 * 挂画布**底部**是刻意的：顶部中央是事件横幅区、底部中央是全场事件胶囊，
 * 两处都占不得 —— 所以 1P 挂左下、2P 挂右下。
 * 纯矢量（无 emoji），所以在没有 emoji 字体的渲染环境里也照样看得见。 */
function drawLibCalm(g) {
  if (!libOn()) return;
  if (state !== 'play') return;
  for (var i = 0; i < humans.length; i++) {
    var h = humans[i];
    if (!h.alive) continue;
    libCalmInit(h);
    var L = SCENE.lib;
    var pct = clamp(h.calm / L.calmMax, 0, 1);
    var bw = S36(108), bh = S36(11);
    var y = CH - WALL_B + S36(7);
    var x, tx, align;
    if (i === 0) {
      x = WALL_L + S36(6) + S36(40); tx = WALL_L + S36(6); align = 'left';
    } else {
      x = CW - WALL_R - S36(6) - bw; tx = x - S36(6); align = 'right';
    }
    g.save();
    g.textAlign = align; g.textBaseline = 'middle';
    g.font = font(FS('sub'), 800);
    g.fillStyle = 'rgba(40,60,90,.9)';
    g.fillText(i === 0 ? '安静值' : '2P', tx, y + bh / 2);
    g.fillStyle = 'rgba(20,30,50,.18)';
    g.fillRect(x, y, bw, bh);
    g.fillStyle = pct > 0.6 ? '#3E9E62' : (pct > 0.3 ? '#D9A020' : '#D04030');
    g.fillRect(x, y, bw * pct, bh);
    g.strokeStyle = 'rgba(20,30,50,.35)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
    g.restore();
  }
}

/* ---------- 食堂四个区域的底纹 ----------
 * 四个区域必须**一眼分得清**，否则玩家不知道该往哪儿跑：
 *   快速窗口  顶部横带 + 蓝色虚线（打饭窗口 / 取餐号屏就在上面）
 *   热门档口  中段左带 + 橙色实线框（取餐台那面墙，热门位只长在这里）
 *   窗边桌    中段右带 + 青色实线框（右墙的窗）
 *   双人桌    底部横带 + 粉色虚线
 * 全是纯矢量，不依赖 emoji 字体。教室/图书馆第一行就返回。 */
/* 区域标签的测量宽度缓存：键是「字体串 + 文字」，值是宽度。
 * 标签是常量字符串，宽度一辈子不变，没必要每帧 measureText 四次。
 * 纯缓存，不参与模拟，也不消耗随机数。 */
var zoneLabelW = {};

function drawDineZones(g) {
  if (!dineOn()) return;
  var fm = dineFastRowMax(), bm = dineBottomRowMin();
  var sc = dineStallColMax(), wc = dineWindowColMin();
  var fullW = COLS * TILE;
  var fy0 = TY(1), fy1 = TY(fm + 1);
  var sy0 = TY(fm + 1), sy1 = TY(bm);
  var py0 = TY(bm), py1 = TY(ROWS);
  var sx0 = TX(1), sx1 = TX(sc + 1);
  var wx0 = TX(wc), wx1 = TX(COLS - 1);
  g.save();

  /* 四个区域的底色统一压淡一档（原来 .11~.13）：四块同时上色等于谁也没被突出，
     现在靠虚线框 / 实线框区分区域，底色只负责「让人知道这里是一块区域」。 */
  /* 快速窗口（顶部横带） */
  g.fillStyle = 'rgba(70,150,220,.07)';
  g.fillRect(WALL_L, fy0, fullW, fy1 - fy0);
  g.strokeStyle = 'rgba(40,110,180,.45)';
  g.lineWidth = 2; g.setLineDash([9, 7]);
  g.beginPath();
  g.moveTo(WALL_L, fy1 - 0.5); g.lineTo(WALL_L + fullW, fy1 - 0.5);
  g.stroke();
  g.setLineDash([]);

  /* 热门档口（中段左带） */
  g.fillStyle = 'rgba(235,120,40,.085)';
  g.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
  g.strokeStyle = 'rgba(200,90,20,.55)';
  g.lineWidth = 2;
  g.strokeRect(sx0 + 1, sy0 + 1, sx1 - sx0 - 2, sy1 - sy0 - 2);

  /* 窗边桌（中段右带） */
  g.fillStyle = 'rgba(60,170,190,.075)';
  g.fillRect(wx0, sy0, wx1 - wx0, sy1 - sy0);
  g.strokeStyle = 'rgba(30,130,150,.5)';
  g.lineWidth = 2;
  g.strokeRect(wx0 + 1, sy0 + 1, wx1 - wx0 - 2, sy1 - sy0 - 2);

  /* 双人桌（底部横带） */
  g.fillStyle = 'rgba(200,70,140,.07)';
  g.fillRect(WALL_L, py0, fullW, py1 - py0);
  g.strokeStyle = 'rgba(170,50,115,.45)';
  g.lineWidth = 2; g.setLineDash([9, 7]);
  g.beginPath();
  g.moveTo(WALL_L, py0 + 0.5); g.lineTo(WALL_L + fullW, py0 + 0.5);
  g.stroke();
  g.setLineDash([]);

  /* 标签一律挂各自区域的**左端**：顶部中央是事件横幅区、底部中央是事件胶囊，
     中间那两个竖带又窄，所以左右分开放最安全（见 1k）。
     文字压到最短：原来「快速窗口 · 出餐快」「双人桌 · 队伍 +2」这种长句直接摊在座位上，
     四个区域同时用长文字喊话，谁也没被突出（§二.2 要求用描边 / 高亮区域提示，
     不要依赖长文字说明）。数值细节留给图例和任务面板。
     每块标签垫一层半透明底板 —— 底下是座位和占座物，不垫就读不清。
     标签文字是常量，宽度按「字体串 + 文字」缓存一次，别每帧 measureText。 */
  g.textAlign = 'left'; g.textBaseline = 'middle';
  var zl = [
    { t: '快速窗口 ×2', x: WALL_L + 8, y: fy0 + 13, f: FONT_S.task, c: 'rgba(28,96,160,.95)',  bg: 'rgba(233,242,252,.86)' },
    { t: '双人桌 +2',   x: WALL_L + 8, y: py0 + 13, f: FONT_S.task, c: 'rgba(150,40,100,.95)', bg: 'rgba(250,236,244,.86)' },
    { t: '热门档口',    x: sx0 + 6,    y: sy0 + 13, f: FONT_S.task, c: 'rgba(170,74,10,.95)',  bg: 'rgba(252,241,231,.86)' },
    { t: '窗边桌',      x: wx0 + 6,    y: sy0 + 13, f: FONT_S.task, c: 'rgba(20,112,132,.95)', bg: 'rgba(231,246,250,.86)' }
  ];
  for (var zi = 0; zi < zl.length; zi++) {
    var Z = zl[zi];
    var zfs = font(Z.f, 800);
    g.font = zfs;
    var zw = zoneLabelW[zfs + '|' + Z.t];
    if (zw == null) { zw = g.measureText(Z.t).width; zoneLabelW[zfs + '|' + Z.t] = zw; }
    rr(g, Z.x - 5, Z.y - 9, zw + 10, 18, 5);
    g.fillStyle = Z.bg; g.fill();
    g.fillStyle = Z.c;
    g.fillText(Z.t, Z.x, Z.y);
  }
  g.restore();
}

/* ---------- 「新菜上线」刷出来的高价值区域 ----------
 * 一整块矩形一起高亮，并给个外框 + 「新菜」角标，让玩家一眼看出这是一片区域、
 * 而不是几个零散的热门位（热门位是暖橙色的小圈，两者不能撞色）。 */
function drawDishArea(g, time) {
  if (!dineOn() || !dishCells.length) return;
  var pulse = 0.5 + 0.5 * Math.sin(time * 4.5);
  var minC = 999, maxC = -1, minR = 999, maxR = -1, i, c, r;
  g.save();
  for (i = 0; i < dishCells.length; i++) {
    c = dishCells[i][0]; r = dishCells[i][1];
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    var x0 = CX(c) - TILE / 2, y0 = CY(r) - TILE / 2;
    g.fillStyle = 'rgba(255,196,60,' + (0.22 + 0.10 * pulse).toFixed(3) + ')';
    g.fillRect(x0, y0, TILE, TILE);
    g.strokeStyle = 'rgba(214,138,10,' + (0.55 + 0.35 * pulse).toFixed(3) + ')';
    g.lineWidth = S36(2.2);
    g.strokeRect(x0 + S36(2), y0 + S36(2), TILE - S36(4), TILE - S36(4));
  }
  /* 整块的外框（金色粗线） */
  var bx = CX(minC) - TILE / 2, by = CY(minR) - TILE / 2;
  var bw = (maxC - minC + 1) * TILE, bh = (maxR - minR + 1) * TILE;
  g.strokeStyle = 'rgba(200,138,30,.95)';
  g.lineWidth = S36(3.2);
  g.strokeRect(bx + S36(1.6), by + S36(1.6), bw - S36(3.2), bh - S36(3.2));
  /* 角标：纯矢量胶囊 + 中文（不用 emoji —— 这里画的是 font()） */
  g.font = font(FS('sub'), 900);
  var tw = g.measureText('新菜').width + S36(10);
  rr(g, bx + S36(2), by + S36(2), tw, S36(16), S36(8));
  g.fillStyle = '#C98A1E'; g.fill();
  g.fillStyle = '#FFFFFF';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('新菜', bx + S36(2) + tw / 2, by + S36(2) + S36(8));
  g.restore();
}

/* ---------- 排队长龙 ----------
 * 队伍画在**玩家走过的路径**上：路径的最后一格是玩家现在的位置，
 * 往前倒数就是「跟在身后的那串人」。
 * ⚠️ 不用「最近占下的座位」当锚点 —— 走道和被 NPC 插空的格子会把那条线打断，
 *    画出来是一团散点；玩家走过的路径天然逐格相连，才是真正的「一条长龙」。
 * ⚠️ 刻意**不用 drawChar**：它带 shadowBlur 白色描边，画十几二十个太贵
 *    （移动端本来就只有 ~16ms 的余量）。这里两个路径搞定一个，够读就行。
 * ⚠️ 数量用 h.run（真实长度）而不是 h.queue（已封顶）—— 队伍封顶之后还得继续变长，
 *    否则玩家会以为「到头了」。
 * ⚠️ 只画小人**不够**：路径格本身就是「玩家占下的座位」，而座位图标也是暖色，
 *    光画小人会被读成「一排各自坐着的人」。所以先沿路径铺一条半透明飘带
 *    （把散格连成一根线），再给每个小人垫一圈白边（把自己从座位图标上摘出来）。
 *    实测少了这两层，「排队长龙」在截图里几乎看不出来。
 * ⚠️ 小人必须**按档批量画**。逐个 save/fill/stroke 的话是「每人 3 次 fill + 2 次 stroke」，
 *    12 个人就是 60 次画布状态切换，手机档实测能吃掉排队长龙开销的一大半。
 *    同一档里的人透明度相同，于是 12 段弧/圆角矩形可以并进**一条路径**再一次填充，
 *    画面几乎等价而调用次数从 60 降到 5。尺寸仍按人递减（同一档共用一个半径会看出「台阶」，
 *    所以这里按「半径」而不是「透明度」分档：一档内半径近似、透明度精确一致）。 */
function drawDineQueue(g) {
  if (!dineOn()) return;
  if (state !== 'play') return;
  var L = SCENE.dine;
  for (var i = 0; i < humans.length; i++) {
    var h = humans[i];
    if (!h.alive) continue;
    var n = Math.min(h.run || 0, L.queueDrawMax);
    var tr = h.trail || [];
    if (n <= 1 || tr.length < 2) continue;
    var own = OWN[h.id] || OWN.player;
    /* 从玩家身后往队尾取格：tr 的最后一格是玩家脚下，所以从倒数第二格起算 */
    var pts = [], k, idx;
    for (k = 0; k < n; k++) {
      idx = tr.length - 2 - k;
      if (idx < 0) break;
      pts.push(tr[idx]);
    }
    if (!pts.length) continue;
    var m = pts.length;
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';

    /* ① 「一条队」的形：沿路径铺一条半透明飘带 */
    g.beginPath();
    g.moveTo(CX(h.c), CY(h.r));
    for (k = 0; k < m; k++) g.lineTo(CX(pts[k].c), CY(pts[k].r));
    g.strokeStyle = own.body;
    g.globalAlpha = 0.22;
    g.lineWidth = S36(16);
    g.stroke();

    /* ② 队伍本身：越靠队尾越小。分两档批量画（近端实、远端淡） */
    for (var band = 0; band < 2; band++) {
      var lo = band === 0 ? 0 : Math.ceil(m / 2);
      var hi = band === 0 ? Math.ceil(m / 2) : m;
      if (hi <= lo) continue;
      /* 同一档共用一个半径（取该档中点，档内尺寸差 <= 15%，肉眼看不出来） */
      var tMid = m > 1 ? ((lo + hi - 1) / 2) / (m - 1) : 0;
      var rad = S36(9.6) * (1 - 0.30 * tMid);
      g.globalAlpha = band === 0 ? 0.95 : 0.62;

      /* 白圈垫底：把自己从「座位图标」里摘出来 */
      g.beginPath();
      for (k = lo; k < hi; k++) {
        var cx0 = CX(pts[k].c), cy0 = CY(pts[k].r) + rad * 0.04;
        g.moveTo(cx0 + rad * 1.14, cy0);
        g.arc(cx0, cy0, rad * 1.14, 0, 6.2832);
      }
      g.fillStyle = 'rgba(255,255,255,.78)'; g.fill();

      /* 身体（rr 内部会 beginPath，所以这里用 rrPath 往同一条路径上追加） */
      g.beginPath();
      for (k = lo; k < hi; k++) {
        rrPath(g, CX(pts[k].c) - rad * 0.92, CY(pts[k].r) - rad * 0.10,
          rad * 1.84, rad * 1.34, rad * 0.62);
      }
      g.fillStyle = own.body; g.fill();
      g.strokeStyle = own.edge; g.lineWidth = S36(1.4); g.stroke();

      /* 头 */
      g.beginPath();
      for (k = lo; k < hi; k++) {
        var cx1 = CX(pts[k].c), cy1 = CY(pts[k].r) - rad * 0.86;
        g.moveTo(cx1 + rad * 0.60, cy1);
        g.arc(cx1, cy1, rad * 0.60, 0, 6.2832);
      }
      g.fillStyle = '#FFE1C4'; g.fill();
      g.strokeStyle = own.edge; g.lineWidth = S36(1.2); g.stroke();
    }
    g.restore();
  }
}

/* ---------- 食堂 HUD：饭菜资源 + 当前队伍倍率 ----------
 * 和图书馆的安静值仪表抢的是同一个位置（底部墙面带），但两个场景互斥，不会打架。
 * 1P 挂左下、2P 挂右下 —— 顶部中央是横幅区、底部中央是事件胶囊，都占不得。
 * 纯矢量（饭碗是自己画的），所以在没有 emoji 字体的渲染环境里照样看得见。 */
function drawDineHud(g) {
  if (!dineOn()) return;
  if (state !== 'play') return;
  for (var i = 0; i < humans.length; i++) {
    var h = humans[i];
    if (!h.alive) continue;
    var right = (i !== 0);
    var bh = S36(11), fs = FS('sub');
    var y = CH - WALL_B + S36(7);
    var txtFood = '饭菜 ' + (h.food || 0);
    var txtQ = '队伍 ×' + dineQueueMult(h).toFixed(1);
    g.save();
    g.textBaseline = 'middle';
    g.font = font(fs, 800);
    var wFood = g.measureText(txtFood).width;
    var wQ = g.measureText(txtQ).width;
    var bowlW = S36(15), gap = S36(6), gap2 = S36(12);
    var total = bowlW + gap + wFood + gap2 + wQ;
    var x0 = right ? (CW - WALL_R - S36(6) - total) : (WALL_L + S36(6));
    /* 浅色胶囊底：食堂地板是暖黄瓷砖，纯文字会糊在一起 */
    g.fillStyle = 'rgba(255,255,255,.60)';
    rr(g, x0 - S36(6), y - S36(2), total + S36(12), bh + S36(4), (bh + S36(4)) / 2);
    g.fill();
    /* 饭碗（矢量）：碗沿椭圆 + 碗身梯形 + 冒尖的饭 */
    var bcx = x0 + bowlW / 2, bcy = y + bh / 2;
    g.beginPath();
    g.moveTo(bcx - bowlW * 0.50, bcy - bh * 0.14);
    g.lineTo(bcx + bowlW * 0.50, bcy - bh * 0.14);
    g.lineTo(bcx + bowlW * 0.28, bcy + bh * 0.50);
    g.lineTo(bcx - bowlW * 0.28, bcy + bh * 0.50);
    g.closePath();
    g.fillStyle = '#EEF3F8'; g.fill();
    g.strokeStyle = '#7E8792'; g.lineWidth = S36(1.2); g.stroke();
    g.beginPath();
    g.ellipse(bcx, bcy - bh * 0.14, bowlW * 0.50, bh * 0.22, 0, 0, 6.2832);
    g.fillStyle = '#FFFFFF'; g.fill();
    g.strokeStyle = '#7E8792'; g.lineWidth = S36(1); g.stroke();
    g.beginPath();
    g.ellipse(bcx, bcy - bh * 0.30, bowlW * 0.30, bh * 0.17, 0, 0, 6.2832);
    g.fillStyle = '#FFFDF6'; g.fill();
    /* 文字 */
    g.textAlign = 'left';
    var tx = x0 + bowlW + gap;
    g.fillStyle = '#3A2E22';
    g.fillText(txtFood, tx, y + bh / 2);
    g.fillStyle = (h.queue || 0) >= 8 ? '#B04A1E' : '#2E6B4F';
    g.fillText(txtQ, tx + wFood + gap2, y + bh / 2);
    g.restore();
  }
}

function drawSceneOverlays(g, time) {
  drawLibZones(g);
  drawDineZones(g);
  drawDishArea(g, time);
  var rows = sceneQuietRows();
  if (rows) {
    var y0 = TY(rows.r0), y1 = TY(rows.r1 + 1);
    g.save();
    g.fillStyle = 'rgba(90,120,160,.10)';
    g.fillRect(WALL_L, y0, COLS * TILE, y1 - y0);
    g.strokeStyle = 'rgba(90,120,160,.45)';
    g.lineWidth = 2;
    g.setLineDash([9, 7]);
    g.beginPath();
    g.moveTo(WALL_L, y0 + 0.5); g.lineTo(WALL_L + COLS * TILE, y0 + 0.5);
    g.moveTo(WALL_L, y1 - 0.5); g.lineTo(WALL_L + COLS * TILE, y1 - 0.5);
    g.stroke();
    g.setLineDash([]);
    /* 标签挂在安静区上边界内侧，避开顶部中央的横幅区 */
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = font(FS('hud'), 800);
    g.fillStyle = 'rgba(60,90,130,.85)';
    /* 标签挂在安静区上边界内侧，避开顶部中央的横幅区。
       第六阶段起安静区不只是「禁冲刺」——它同时是**高分但走得慢**的区域，
       所以标签要把这笔交易说清楚。
       图书馆里还要**让开左边的插座区**：那片琥珀底会把字盖住，看不清。
       教室 libOn() 为 false → 仍然是原来的 WALL_L + 8，逐字不变。 */
    var qlx = libOn() ? Math.max(WALL_L + 8, TX(libPlugColMax() + 1) + 8) : WALL_L + 8;
    g.fillText('安静区 · 高分 / 慢行', qlx, y0 + 14);
    g.restore();
  }
  if (hotCells.length) {
    for (var i = 0; i < hotCells.length; i++) {
      var hc = hotCells[i];
      var hx = CX(hc[0]), hy = CY(hc[1]);
      var pulse = 0.5 + 0.5 * Math.sin(time * 5 + i);      /* 0~1 呼吸 */
      var x0 = CX(hc[0]) - TILE / 2, y0 = CY(hc[1]) - TILE / 2;
      g.save();
      /* 「热门位 = 占下额外 +60 分」是实打实的收益，必须一眼看得见。
         所以做四层：整格暖色底 → 橙色描边环 → 中心光晕 → 角标火苗。
         ⚠️ 火苗（emoji）只当**装饰**，不能当唯一信号 ——
            有些环境（含渲染截图用的 @napi-rs/canvas）没有 emoji 字体，
            emoji 会画成空/方框；前三层是纯矢量，任何环境都成立。 */
      g.fillStyle = 'rgba(255,120,20,' + (0.20 + 0.10 * pulse).toFixed(3) + ')';
      g.fillRect(x0, y0, TILE, TILE);
      g.strokeStyle = 'rgba(238,108,10,' + (0.60 + 0.35 * pulse).toFixed(3) + ')';
      g.lineWidth = S36(2.5);
      g.strokeRect(x0 + S36(2), y0 + S36(2), TILE - S36(4), TILE - S36(4));
      g.fillStyle = 'rgba(255,150,40,' + (0.26 + 0.18 * pulse).toFixed(3) + ')';
      g.beginPath(); g.arc(hx, hy, S36(15) * (0.85 + 0.25 * pulse), 0, 6.2832); g.fill();
      /* 火苗挂格子左上角 —— 格子中央留给座位上的物品图标（插座位/空调位…），
         热门位也可能刷到这些格子上，画在中心会互相盖住。 */
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = emojiFont(FS('ico'));
      g.fillText('🔥', x0 + S36(10), y0 + S36(10));
      g.restore();
    }
  }
}

function render(time) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, CW, CH);

  ctx.save();
  if (shakeT > 0) {
    var m = shakeMag * (shakeT / shakeDur);
    ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
  }

  /* 局部放大：仅「单人 + 游玩中」。双人/开始页/结算页都保持全景。 */
  var follow = ZOOM_ON && !isVersus() && humans.length === 1 && state === 'play';
  if (follow) { updateCamera(); ctx.save(); ctx.scale(ZOOM, ZOOM); ctx.translate(-camX, -camY); }

  ctx.drawImage(bg, 0, 0, CW, CH);

  drawPulses(ctx, time);

  /* 先铺自己的路线光带（在座位下面），座位本身再压上去 */
  drawRouteGlow(ctx, time);

  /* 学霸地图：只在技能生效期间才真的有绘制，平时是一次空循环 */
  drawMapHints(ctx, time);

  /* 最后 15 秒：还没人占的高价值座位加一圈很淡的呼吸光环（手册 §十一「略加强」）。
     和学霸地图同层，但弱一档 —— 它只是「略加强」，不能抢走玩家对角色前方的注意力。 */
  drawFinalRushHints(ctx, time);

  var i, t, c, r;
  for (i = 0; i < grid.length; i++) {
    t = grid[i];
    if (!t.owner) continue;
    c = i % COLS; r = (i / COLS) | 0;
    drawSeatDynamic(ctx, c, r, t, time);
  }

  drawContests(ctx, time);
  drawEventZones(ctx, time);
  drawSceneOverlays(ctx, time);      /* 场景专属：图书馆三区域 / 食堂四区域 + 热门位 + 新菜区域 */
  /* 阶段 8 追加 R3.1（2026-10-22 用户反馈「第二次放技能有的没标记」）：
     室友记号必须画在【清理预告层】之后 —— 那一层会给每格画整格橙填充 α.20~.36 +
     橙色虚线环（inset 1.5 / lw 3）+ 右上角倒计时数字，而它排在座位层后面，
     会把记号整个盖掉。第一次放技能在开局（没有预告）→ 正常；第二次在 22~27 秒
     （30 秒那次清理的预告已经亮了）→ 一片「没标记」。时序完全对得上。
     仍在 `drawEntities` 之前 —— 记号是地面信息，不能盖住角色。 */
  drawHelperClaimMarks(ctx);
  /* ⚠️ 2026-10-08：`drawLibCalm` / `drawDineHud` **不再画在这里** ——
     它们是「屏幕底部左右角」的固定状态条，而上面这整段都在**相机变换之内**
     （`follow` 时 `scale(ZOOM)` + `translate(-camX,-camY)`）。
     画在变换里 → 开了「个人跟随」放大后，安静值 / 饭菜条会跟着地图一起偏移、放大、
     被推到画面外（用户 2026-10-08 报的「左下角安静值不固定在左下角」就是这个）。
     现在移到 `if (follow) ctx.restore();` **之后**的屏幕固定层，
     与 `drawBanners` / `drawOffscreenArrow` 同一层（那两层本来就是这么处理的）。
     两个函数内部的坐标**不用改** —— 它们本来就按「屏幕底边 CH - WALL_B」算的。 */
  drawDineQueue(ctx);                /* 食堂排队长龙（画在玩家底下，让玩家压在最上面） */
  drawParticles(ctx, false);
  drawEntities(ctx, time);
  drawEventActors(ctx, time);
  drawParticles(ctx, true);
  drawFloats(ctx);

  /* 新手引导气泡：跟着玩家走，所以要画在相机变换之内（缩放时整块一起放大）。
     零随机消耗 —— 只有读状态和画东西。 */
  drawTutorial(ctx, time);

  if (follow) ctx.restore();   /* 结束相机变换，下面两层是屏幕固定层 */

  /* ⚠️ 2026-10-08：底部左右角的「固定状态条」必须在**相机变换之外**画。
     它们按「屏幕底边」（`CH - WALL_B`）定位，语义就是屏幕角落 ——
     画在变换里的话，开了个人跟随放大后会被 `translate(-camX,-camY)` 推走。
     位置和原来的相邻关系都保留（仍在 `drawOffscreenArrow` 之前，
     仍在 `drawTutorial` 之后）—— 搬的只是坐标系，不是图层顺序。
     这两次调用**不消耗随机数**（只读状态 + 画），所以搬动不影响铁律 1。 */
  drawLibCalm(ctx);                  /* 图书馆安静值仪表（屏幕左下 / 右下） */
  drawDineHud(ctx);                  /* 食堂饭菜 / 队伍倍率（屏幕左下 / 右下） */

  /* 横幅（顶部中央）不随相机缩放，始终在屏幕固定位置 */
  drawBanners(ctx, time);
  if (follow) drawOffscreenArrow(ctx, time);

  ctx.restore();

  /* 边缘暗角 */
  ctx.save();
  ctx.globalAlpha = 0.10;
  var vg = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.34, CW / 2, CH / 2, CH * 0.92);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(60,40,10,1)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, CW, CH);
  ctx.restore();

  /* ============ 暂停暗屏（2026-10-10） ============
   * 画在**最后一层**（暗角之后），所以它盖住的是「整幅游戏画面」。
   *
   * 为什么要画这一层，而不是只靠 HTML 的 #screen-pause？
   *   · 需求原文是「在**游戏进行页面内**加暂停键」—— 玩家的心智里，
   *     「暂停」应该让**画面本身**停住并变暗，而不只是弹一张卡。
   *   · HTML 遮罩的尺寸取决于画布随视口缩放的结果：视口一变，
   *     卡片可能盖不全画布，边缘会露出一圈还在动的游戏（假「暂停」感）。
   *     画布内这一层是跟着画面一起缩放的，**任何窗口尺寸都严丝合缝**。
   * 两层叠加时暗度是乘法关系（HTML 的 rgba 叠在画布的 rgba 上），
   * 所以这里只取 0.42，避免叠过头变成纯黑。
   *
   * ⚠️ 零随机、零模拟：只读 PAUSED 与 CW/CH 两个常量，
   *    既不消耗 Math.random()，也不推进任何计时 —— 对铁律 1 / 指纹无影响。 */
  if (PAUSED) {
    ctx.save();
    ctx.fillStyle = 'rgba(28,18,6,0.42)';
    ctx.fillRect(0, 0, CW, CH);
    ctx.restore();
  }
}

/* ==========================================================
 * 14. HUD 同步
 * ========================================================== */

var lastHud = { score: -1, seats: -1, time: '', combo: -1, best: -1 };
var lastHud2 = { score: -1, seats: -1, combo: -1 };

/* V1.5：普通占座不再飘分，改由 HUD 给反馈。
 * 重新触发 CSS 动画必须先摘掉 class 再强制一次重排，否则同一个 class 连加两次不重播。 */
function bumpScore(box) {
  if (!box || !box.classList) return;
  box.classList.remove('bump');
  void box.offsetWidth;
  box.classList.add('bump');
}

/* 暂停 / 退出两个圆按钮的显隐（2026-10-10）。
 * 只在 count / play / over 三个状态显示：
 *   · start  —— 还没有「这一局」，无可暂停、无可退出；开始页上多两个圆钮只是噪音。
 *   · over   —— 结算卡自己已经盖住大半屏，退出入口在卡上（换个角色 / 再来一局），
 *               圆钮留着也行，但**暂停**没有意义，所以这里统一让它俩一起出现、
 *               暂停在 over 态点了会被 canPause() 拒掉（无副作用）。
 * 每帧调用（在 syncHud 里），所以用一个缓存的 lastCtrl 挡重复写 DOM。 */
var lastCtrl = -1;
function syncCtrlBtns() {
  var show = (state === 'count' || state === 'play' || state === 'over') ? 1 : 0;
  if (show === lastCtrl) return;
  lastCtrl = show;
  if (btnPause) btnPause.classList.toggle('hidden', !show);
  if (btnQuit) btnQuit.classList.toggle('hidden', !show);
}

function syncHud(force) {
  /* 1P */
  if (force || player.score !== lastHud.score) {
    if (!force && player.score !== lastHud.score) bumpScore(elScoreBox);
    lastHud.score = player.score; elScore.textContent = String(player.score);
  }
  if (force || player.seatCount !== lastHud.seats) { lastHud.seats = player.seatCount; elSeats.textContent = String(player.seatCount); }
  if (force || bestScore !== lastHud.best) { lastHud.best = bestScore; elBest.textContent = String(bestScore); }

  /* 今日任务面板：内部有签名比对，内容没变时直接返回 */
  syncTaskPanel();

  var showCombo = player.combo >= 2 && (performance.now() - player.lastClaimAt < COMBO_WINDOW);
  if (force || player.combo !== lastHud.combo) {
    lastHud.combo = player.combo;
    if (showCombo) { elComboN.textContent = String(player.combo); elCombo.classList.remove('hidden'); }
    else elCombo.classList.add('hidden');
  }

  /* 2P（仅双人模式） */
  var p2 = isVersus() ? humans[1] : null;
  if (p2) {
    if (force || p2.score !== lastHud2.score) {
      if (!force && p2.score !== lastHud2.score) bumpScore(elScoreBox2);
      lastHud2.score = p2.score; elScore2.textContent = String(p2.score);
    }
    if (force || p2.seatCount !== lastHud2.seats) { lastHud2.seats = p2.seatCount; elSeats2.textContent = String(p2.seatCount); }
    var showCombo2 = p2.combo >= 2 && (performance.now() - p2.lastClaimAt < COMBO_WINDOW);
    if (force || p2.combo !== lastHud2.combo) {
      lastHud2.combo = p2.combo;
      if (showCombo2) { elComboN2.textContent = String(p2.combo); elCombo2.classList.remove('hidden'); }
      else elCombo2.classList.add('hidden');
    }
  }

  /* 技能栏 */
  syncSkills(player, 0);
  if (p2) syncSkills(p2, 1);

  /* 计时（两人共用） */
  var sec = Math.max(0, Math.ceil(timeLeft));
  var mm = Math.floor(sec / 60), ss = sec % 60;
  var str = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  if (force || str !== lastHud.time) {
    lastHud.time = str;
    elTime.textContent = str;
  }
  elTimeWrap.classList.toggle('warn', sec <= 30 && state === 'play');
  /* 最后 15 秒：时间数字再突出一点（手册 §十一）。纯样式，和 warn 是叠加关系。 */
  elTimeWrap.classList.toggle('final', finalRush && state === 'play');

  /* 暂停 / 退出两个圆按钮的显隐（2026-10-10）—— 跟 HUD 同一拍刷 */
  syncCtrlBtns();
}

/* ==========================================================
 * 15. 自适应缩放
 * ========================================================== */

/* 一个铺满视口的 fixed 探针，用来「实测」可视区域。
 * 浏览器上报的 innerWidth/innerHeight 在内嵌面板里经常把标题栏、地址栏
 * 也算进去（偏大），而 fixed + inset:0 元素的 getBoundingClientRect()
 * 是真实布局结果，不会被这类误差影响。 */
var fitProbe = null;

function ensureProbe() {
  if (fitProbe) return;
  /* 挂在 <html> 上而不是 <body>：万一 body 上有 transform / filter，
     fixed 定位的参照物会变成 body 而不是视口，挂到根元素更保险。 */
  var host = document.documentElement;
  if (!host || !host.appendChild) host = document.body;
  if (!host || !host.appendChild) return;
  var d = document.createElement('div');
  d.style.cssText =
    'position:fixed;left:0;top:0;right:0;bottom:0;' +
    'visibility:hidden;pointer-events:none;z-index:-1;';
  try { host.appendChild(d); fitProbe = d; } catch (e) { fitProbe = null; }
}

function probeRect() {
  ensureProbe();
  if (!fitProbe || !fitProbe.getBoundingClientRect) return null;
  var r = fitProbe.getBoundingClientRect();
  if (!r || !(r.width > 0) || !(r.height > 0)) return null;
  return r;
}

/* 取所有尺寸来源里最小的那个，宁小勿大——画面小一点总比被裁掉好 */
function viewportSize() {
  var w = Infinity, h = Infinity, i, cw, ch, r;
  var cands = [];

  r = probeRect();
  if (r) cands.push([r.width, r.height]);
  if (window.visualViewport) {
    cands.push([window.visualViewport.width, window.visualViewport.height]);
  }
  cands.push([window.innerWidth, window.innerHeight]);
  if (document.documentElement) {
    cands.push([document.documentElement.clientWidth, document.documentElement.clientHeight]);
  }
  if (document.body) {
    cands.push([document.body.clientWidth, document.body.clientHeight]);
  }

  for (i = 0; i < cands.length; i++) {
    cw = cands[i][0];
    ch = cands[i][1];
    if (cw > 0 && ch > 0) {
      if (cw < w) w = cw;
      if (ch < h) h = ch;
    }
  }
  if (!isFinite(w) || w <= 0) w = 1024;
  if (!isFinite(h) || h <= 0) h = 768;
  return { w: w, h: h };
}

var lastFitKey = '';

/* 画布逻辑尺寸随布局变化，CSS 尺寸要同步写回 */
function applyCanvasSize() {
  canvas.width = Math.round(CW * DPR);
  canvas.height = Math.round(CH * DPR);
  canvas.style.width = CW + 'px';
  canvas.style.height = CH + 'px';
  frame.style.width = CW + 'px';
  frame.style.height = CH + 'px';
  layoutTaskPanel();          /* 面板位置跟着画布版式走 */
}

function applyFit(s) {
  var w = Math.max(1, Math.round(CW * s));
  var h = Math.max(1, Math.round(CH * s));
  stage.style.width = w + 'px';
  stage.style.height = h + 'px';
  if (frame.style.setProperty) frame.style.setProperty('--fit', String(w / CW));
  else frame.style.transform = 'scale(' + (w / CW) + ')';
  return w;
}

/* 在紧凑版 / 标准版之间切换：几何变了必须重建关卡 */
function switchLayout(compact) {
  configureLayout(compact);
  applyCanvasSize();
  lastFitKey = '';
  resetGame(state === 'start');
  fit();
}

function fit() {
  var vp = viewportSize();

  /* 视口跨过阈值就换布局；对局进行中不打断，等下一局再换 */
  var wantCompact = Math.min(vp.w, vp.h) < 620;
  if (wantCompact !== COMPACT && (state === 'start' || state === 'over')) {
    switchLayout(wantCompact);
    return;
  }

  var pad = 16;
  var aw = Math.max(160, vp.w - pad * 2);
  var ah = Math.max(160, vp.h - pad * 2);
  var s = Math.min(aw / CW, ah / CH, 1.4);
  if (!isFinite(s) || s <= 0.05) s = 0.05;

  var w = Math.round(CW * s);
  var key = w + (COMPACT ? 'c' : 'f');
  if (key === lastFitKey) return;      /* 尺寸没变就不碰 DOM */
  lastFitKey = key;

  /* #stage 是 fixed + inset:0 + margin:auto，浏览器自己负责居中；
     我们只把算好的尺寸写进去，内部整体等比缩放。 */
  applyFit(s);

  /* 兜底自检：拿真实布局结果再核一次，万一哪里还是算大了就自己缩回去 */
  var pr = probeRect();
  if (pr && stage.getBoundingClientRect) {
    var sr = stage.getBoundingClientRect();
    if (sr.width > 1 && sr.height > 1) {
      var k = Math.min((pr.width - 2) / sr.width, (pr.height - 2) / sr.height, 1);
      if (k < 0.999) applyFit(s * k * 0.995);
    }
  }

  /* 只在第一次打一条日志，方便排查「画面尺寸不对」的问题 */
  if (!fitLogged && window.console && console.log) {
    fitLogged = true;
    console.log('[这排我占了] 可视区域 ' + Math.round(vp.w) + '×' + Math.round(vp.h) +
      '，' + (COMPACT ? '紧凑版' : '标准版') + '布局 ' + CW + '×' + CH +
      '，画面缩放到 ' + w + '×' + Math.round(CH * (w / CW)));
  }
}

var fitLogged = false;

/* ==========================================================
 * 16. 启动
 * ========================================================== */

function loadBest() {
  try {
    var v = parseInt(localStorage.getItem('zhanzuo_best_v1') || '0', 10);
    bestScore = isNaN(v) ? 0 : v;
  } catch (e) { bestScore = 0; }
}

function onViewportChange() {
  detectTouch();
  fit();
}

function boot() {
  loadBest();
  /* 新手引导的「看过没」也只读一次 —— 和最高分一样属于玩家存档 */
  tutLoad();
  /* 阶段 4：`?purepvp=1` 必须在**第一次 resetGame 之前**解析 ——
     resetGame 里就要决定建不建 NPC、以及双方从哪儿进场。 */
  purePvpFromUrl();
  configureLayout(shouldUseCompact());
  applyCanvasSize();
  resetGame(true);
  detectTouch();

  initSkillUI();
  btnStart.addEventListener('click', function () {
    if (NET.vsOnline) { startOnlineHost(); return; }
    startMode(MODE);
  });
  $('btn-vs-local').addEventListener('click', function () { setVsOnline(false); });
  $('btn-vs-online').addEventListener('click', function () { setVsOnline(true); });
  $('btn-copy-link').addEventListener('click', function () {
    var url = inviteUrl(NET.room);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url);
      else { var ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
      netStatus('链接已复制，发给好友就能开打');
    } catch (e) { netStatus('复制失败，请手动选中上面的链接'); }
  });

  /* URL 里带 ?room=XXXX → 自动以访客身份加入 */
  var roomParam = null;
  try {
    var m = /[?&]room=([^&]+)/.exec(window.location.search || '');
    if (m) roomParam = decodeURIComponent(m[1]);
  } catch (e) {}
  if (roomParam) {
    setVsOnline(true);
    joinOnlineGuest(roomParam);
  }
  $('btn-mode-solo').addEventListener('click', function () { MODE = 'solo'; syncModeUI(); });
  $('btn-mode-versus').addEventListener('click', function () { MODE = 'versus'; syncModeUI(); });

  /* 局部放大（跟随自己）：单人模式才勾得上，双人时开关被隐藏且 ZOOM_ON 已被清零 */
  var chkZoom = document.getElementById('chk-zoom');
  if (chkZoom) chkZoom.addEventListener('change', function () { ZOOM_ON = chkZoom.checked; });

  /* 场景选择（V1.5 第五阶段）：教室 / 图书馆 / 食堂 */
  (function () {
    var ids = ['classroom', 'library', 'canteen'];
    for (var si = 0; si < ids.length; si++) {
      (function (sid) {
        var el = document.getElementById('btn-scene-' + sid);
        if (el && el.addEventListener) {
          el.addEventListener('click', function () { sceneSet(sid); syncSceneUI(); });
        }
      })(ids[si]);
    }
  })();
  /* 技能图标：鼠标点、手指点都能放（这也是触屏设备唯一的技能入口）。
     V1.6 第二阶段：只剩槽位 0，循环上界跟着 SKILL_SLOT_COUNT 走。 */
  for (var si = 0; si < SKILL_SLOT_COUNT; si++) {
    (function (slot) {
      var r1 = skillUI[0][slot].root, r2 = skillUI[1][slot].root;
      if (r1 && r1.addEventListener) r1.addEventListener('click', function () { useSkill(humans[0], slot); });
      if (r2 && r2.addEventListener) r2.addEventListener('click', function () { useSkill(humans[1], slot); });
    })(si);
  }
  /* 角色卡 */
  for (var rp = 1; rp <= 2; rp++) {
    for (var ri = 0; ri < ROLES.length; ri++) {
      (function (pi, rid) {
        var el = $('role-' + pi + '-' + rid);
        if (el && el.addEventListener) {
          el.addEventListener('click', function () { rolePick[pi - 1] = rid; syncRoleUI(); });
        }
      })(rp, ROLES[ri].id);
    }
  }
  syncModeUI();
  syncSceneUI();
  btnRestart.addEventListener('click', restart);
  /* 【换个角色】只出现在单人结算卡上（双人没有角色可换，也就没这个按钮） */
  if (btnRestartRole && btnRestartRole.addEventListener) btnRestartRole.addEventListener('click', backToStart);
  btnRestartVs.addEventListener('click', restart);
  btnSound.addEventListener('click', toggleSound);

  /* 暂停 / 退出（2026-10-10）：右下角两个圆钮。
     暂停钮是「切换」语义（暂停 ↔ 继续），所以图标随状态换（见 setPaused）；
     退出钮直接回开始页，与结算卡的【换个角色】同一个出口。 */
  if (btnPause && btnPause.addEventListener) btnPause.addEventListener('click', function () { togglePause(); });
  if (btnQuit && btnQuit.addEventListener) btnQuit.addEventListener('click', quitToStart);
  if (btnResume && btnResume.addEventListener) btnResume.addEventListener('click', function () { setPaused(false); });
  if (btnPauseQuit && btnPauseQuit.addEventListener) btnPauseQuit.addEventListener('click', quitToStart);

  /* 玩法规则面板：入口一个，出口三个（✕ / 底部主按钮 / 点卡片外空白处）。
     三个出口都走同一个 hideRules()，不留第二种关闭路径。 */
  if (btnRules && btnRules.addEventListener) btnRules.addEventListener('click', showRules);
  if (btnRulesClose && btnRulesClose.addEventListener) btnRulesClose.addEventListener('click', hideRules);
  if (btnRulesOk && btnRulesOk.addEventListener) btnRulesOk.addEventListener('click', hideRules);
  if (elRules && elRules.addEventListener) {
    elRules.addEventListener('click', function (e) {
      /* 只有点在遮罩本身（卡片之外）才关；点卡片内部不关 */
      if (e && e.target === elRules) hideRules();
    });
  }
  /* 列表滚到底就把提示收掉；窗口尺寸变了（标准版↔紧凑版）要重新量一次 */
  if (elRulesList && elRulesList.addEventListener) elRulesList.addEventListener('scroll', syncRulesMore);
  if (window.addEventListener) window.addEventListener('resize', syncRulesMore);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearKeys);
  bindTouch();
  initRotateUI();

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearKeys();
    else fit();
  });

  /* ---- 自适应尺寸：多重监听 + 兜底轮询 ----
   * 有些内嵌浏览器在面板被拖动改变大小时不派发 resize，所以除了事件之外
   * 再挂一个低频轮询（尺寸没变化时 fit() 会立刻返回，开销可忽略）。 */
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  if (window.visualViewport && window.visualViewport.addEventListener) {
    window.visualViewport.addEventListener('resize', fit);
    window.visualViewport.addEventListener('scroll', fit);
  }
  if (window.ResizeObserver) {
    try {
      var ro = new window.ResizeObserver(fit);
      ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
    } catch (e) { /* 不支持就算了，后面的轮询兜底 */ }
  }
  setInterval(fit, 700);

  fit();
  /* 字体/布局稳定后再校正一次 */
  requestAnimationFrame(function () { fit(); });
  setTimeout(fit, 60);
  setTimeout(fit, 400);

  requestAnimationFrame(loop);
}

var lastT = 0;

function loop(ts) {
  if (!lastT) lastT = ts;
  var dt = Math.min((ts - lastT) / 1000, 0.05);
  lastT = ts;

  update(dt);
  syncHud(false);
  render(ts / 1000);

  requestAnimationFrame(loop);
}

boot();

})();
