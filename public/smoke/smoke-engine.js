/**
 * smoke-engine.js — เอนจินควันรอบกรอบข้อความ (สไปรต์ 3 ระนาบ + enter/idle/exit)
 *
 * ไฟล์นี้ "ดึงมาตรง ๆ" จากระบบเก่า เพื่อให้การ์ดโดเนทของระบบใหม่ใช้ควันลุคเดียวกับ
 * การ์ดแจ้งเตือน Follow เป๊ะ (ไม่มีการเขียนศิลป์ใหม่ -> ไม่คลาดเคลื่อน)
 *
 *   ต้นทาง : poomes-stream-system/views/alert.html
 *            helper query 1429-1443 · config 1677-1729 · engine 1730-2639
 *   สัญญา : window.StreamSmoke = { spawn, release, warm, remeasure, rebuild, debug }
 *            StreamSmoke.spawn(canvasEl, textEl, fill?) -> instance
 *            instance.phase = "idle" | "exit"           (ผู้เรียกเป็นคนสั่งเปลี่ยนเฟส)
 *            StreamSmoke.release(instance)              -> ตัดออกจาก loop ทันที
 *
 *   CSS ที่ต้องมีคู่กัน (คัดจาก alert.html บรรทัด 161-183):
 *            canvas อยู่หลังข้อความ (z-index 0) ขอบกว้างกว่ากรอบข้อความ 128% x 152%
 *            + mask radial-gradient ให้ขอบนอกสุดจางหาย (ห้ามแตะขอบแข็ง -> กันเห็นกรอบสี่เหลี่ยม)
 *
 *   URL query: ?smoke=A1..C3 (พรีเซ็ต) · ?enterMs= ?exitMs= · ?smokedev=1
 *
 * ⚠️ ไฟล์นี้ถูก generate — แก้ที่ alert.html แล้วรัน scripts/extract-smoke-engine.mjs
 */
(function (global) {
    var location = global.location;   // เอนจินอ่าน query จาก URL ของหน้า overlay

function queryFlag(name) {
    return location.search.indexOf(name + "=1") !== -1;
}

function queryNumber(name, fallback) {
    var match = new RegExp("[?&]" + name + "=(-?[0-9.]+)").exec(location.search);
    if (!match) return fallback;
    var value = Number(match[1]);
    return isFinite(value) ? value : fallback;
}

function queryString(name) {
    var match = new RegExp("[?&]" + name + "=([A-Za-z0-9_-]+)").exec(location.search);
    return match ? String(match[1]) : "";
}

    /* ระยะเวลา enter/exit ของควัน (ระบบเก่าดึงจาก config; ที่นี่รับจาก query แทน) */
    var ENTER_MS = queryNumber("enterMs", 1100);
    var EXIT_MS = queryNumber("exitMs", 800);

var SMOKE_FAMILIES = {
    round: {
        id: "round", name: "Round soft mist",
        lobes: [3, 5], jitter: 0.12, spacing: 0.85, elong: 0.10,
        flat: 0.94, blur: [6.5, 4.0, 2.0], shade: [0.045, 0.062],
        rim: 0, tall: 1.00, extKX: 1.00, extKY: 1.00, sizeK: 1.00,
        squash: 0.16, over: 0.03, spin: 3, rise: 0.00
    },
    poof: {
        id: "poof", name: "Comic poof",
        lobes: [4, 6], jitter: 0.26, spacing: 1.18, elong: 0.24,
        flat: 0.80, blur: [4.0, 2.4, 0.7], shade: [0.075, 0.092],
        rim: 1, tall: 1.00, extKX: 1.00, extKY: 0.95, sizeK: 0.98,
        squash: 0.22, over: 0.10, spin: 14, rise: 0.00
    },
    wisp: {
        id: "wisp", name: "Wispier vertical mist",
        lobes: [3, 4], jitter: 0.18, spacing: 1.00, elong: 0.20,
        flat: 0.97, blur: [7.0, 4.5, 2.5], shade: [0.045, 0.070],
        rim: 0, tall: 1.30, extKX: 0.92, extKY: 1.25, sizeK: 1.28,
        squash: 0.12, over: 0.04, spin: 2, rise: 0.30
    }
};

/* 3 ระดับความเข้ม — ใช้ชุดค่าเดียวกันทุก family เพื่อให้เทียบกันได้ตรง ๆ
   opacity = อัลฟารวมของ "กองควัน" ตอน composite (ตัวคุมความเข้มหลัก)
   cap     = เพดานความทึบในกรอบตัวอักษร (กันตัวหนังสือจม) */
var SMOKE_LEVELS = {
    1: { id: 1, name: "Low",    alpha: [0.18, 0.26, 0.32], count: [2, 3, 2], spread: 0.54, blurK: 0.85, cap: 0.45, opacity: 0.34, sizeK: 0.96 },
    2: { id: 2, name: "Medium", alpha: [0.30, 0.42, 0.50], count: [3, 4, 3], spread: 0.60, blurK: 1.00, cap: 0.55, opacity: 0.46, sizeK: 1.00 },
    3: { id: 3, name: "High",   alpha: [0.44, 0.62, 0.72], count: [4, 5, 4], spread: 0.66, blurK: 1.12, cap: 0.62, opacity: 0.58, sizeK: 1.06 }
};

var SMOKE_PRESETS = (function () {
    var map = {};
    var order = [["A", "round"], ["B", "poof"], ["C", "wisp"]];
    for (var i = 0; i < order.length; i++) {
        var fam = SMOKE_FAMILIES[order[i][1]];
        for (var l = 1; l <= 3; l++) {
            var lvl = SMOKE_LEVELS[l];
            var id = order[i][0] + l;
            map[id] = { id: id, family: fam, level: lvl, label: id + " \u2014 " + fam.name + " / " + lvl.name };
        }
    }
    return map;
})();

/* TODO(Phase 2): ค่า default นี้เป็น "ชั่วคราว" จนกว่าจะเลือก art direction */
var SMOKE_DEFAULT = "A2";
var SMOKE_DEV = queryFlag("smokedev");   // เปิดเฉพาะตอนพัฒนา: Smoke.sheet() ดู sprite ที่อบจริง
var SMOKE_ACTIVE = SMOKE_PRESETS[queryString("smoke")] || SMOKE_PRESETS[SMOKE_DEFAULT] || SMOKE_PRESETS.A2;



var Smoke = (function () {
    var TONE = {
        lit:   [242, 246, 252],
        body:  [216, 223, 233],
        shade: [174, 182, 196],
        deep:  [140, 148, 162]
    };

    var atlas = {};          // key -> [ [ [base, lit, shade] x variant ] x 3 ระนาบ ]
    var live = [];
    var rafId = null;
    var last = 0;
    var FILTER_OK = null;
    var SMOKE_VARIANTS = 2;  // จำนวนทรงต่อระนาบ (ความหลากหลายมาจากการหมุน/สเกลของแต่ละก้อน)
    var SHADE_A = 0.50;      // ความเข้มของชั้นเงา (source-atop)
    var LIT_A = 0.42;        // ความเข้มของชั้นไฮไลต์ (source-atop)
    var PLANE_REL = [0.94, 0.98, 1.0];   // น้ำหนักอัลฟาต่อระนาบ (หลัง/กลาง/หน้า)

    function tone(name, alpha) {
        var c = TONE[name];
        return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + alpha + ")";
    }

    /* deterministic PRNG — ทำให้ทรงก้อนควันซ้ำได้ (เทียบ before/after ได้ตรง ๆ) */
    function mulberry32(seed) {
        var a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            var t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function supportsFilter(ctx) {
        if (FILTER_OK !== null) return FILTER_OK;
        try {
            ctx.filter = "blur(1px)";
            FILTER_OK = ctx.filter === "blur(1px)";
            ctx.filter = "none";
        } catch (error) {
            FILTER_OK = false;
        }
        if (SMOKE_DEV && queryFlag("nofilter")) FILTER_OK = false;   // เทส: บังคับใช้เส้นทาง fallback
        return FILTER_OK;
    }

    /* สร้างก้อนเมฆ: 3-6 lobe เรียงเป็นกลุ่ม (centers ถ่างกว่า รัศมีก้อน -> ขอบเป็นลูก ๆ ชัด)
       ถ้า centers ใกล้กันเกินไป union จะกลายเป็นวงรี/สี่เหลี่ยมมน = ดูไม่ออกว่าเป็นก้อนควัน
       คืนค่าเป็นหน่วย normalize (1.0 = ครึ่งกรอบ sprite) พร้อมย่อให้พอดีกรอบ */
    function makeLobes(family, rand) {
        var n = family.lobes[0] + Math.floor(rand() * (family.lobes[1] - family.lobes[0] + 1));
        var base = rand() * Math.PI * 2;
        var step = (Math.PI * 2) / n;
        var ring = 0.40 * family.spacing;          // ระยะวางก้อนจากศูนย์กลางกลุ่ม
        var lobes = [];
        var i, ang, rr, lr, u2;

        if (family.id === "wisp") {
            /* สายไอแนวตั้ง: เรียงก้อนขึ้น-ลงเป็นลูกโซ่ (ไม่ใช่วงกลม) */
            for (i = 0; i < n; i++) {
                u2 = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;              // -1 (ล่าง) .. +1 (บน)
                lr = 0.30 * (0.92 + rand() * 0.30);
                lobes.push({
                    x: (rand() - 0.5) * ring * 0.50,
                    y: u2 * ring * 1.70 * family.tall,
                    rx: lr * (0.95 + rand() * 0.25),
                    ry: lr * (1.18 + rand() * 0.30),
                    rot: (rand() - 0.5) * 0.30
                });
            }
        } else {
            for (i = 0; i < n; i++) {
                if (family.id === "poof") {
                    ang = base + (i < n - 1 ? i * step * 0.78 : step * 1.55) + (rand() - 0.5) * 0.40;
                } else {
                    ang = base + i * step + (rand() - 0.5) * 0.40;
                }
                rr = ring * (0.72 + rand() * 0.52);
                lr = 0.36 * (0.80 + rand() * 0.34);
                lobes.push({
                    x: Math.cos(ang) * rr,
                    y: Math.sin(ang) * rr,
                    rx: lr * (1 + (rand() - 0.5) * family.elong * 2),
                    ry: lr * (1 + (rand() - 0.5) * family.elong * 2),
                    rot: (rand() - 0.5) * 0.5
                });
            }
        }

        /* เกล็ดเล็ก ๆ ลอยข้างล่าง (เฉพาะ comic poof) -> อ่านเป็น "พูฟ" ไม่ใช่ก้อนกลมเดียว */
        if (family.id === "poof" && n >= 4) {
            for (i = 0; i < 2; i++) {
                var a2 = (i === 0 ? 1.10 : 2.45) + (rand() - 0.5) * 0.5;
                var r2 = ring * (1.15 + rand() * 0.30);
                var l2 = 0.135 * (0.85 + rand() * 0.45);
                lobes.push({
                    x: Math.cos(a2) * r2,
                    y: Math.sin(a2) * r2 + ring * 0.45,
                    rx: l2,
                    ry: l2 * 1.05,
                    rot: (rand() - 0.5) * 0.4
                });
            }
        }

        var extX = 0, extY = 0;
        for (i = 0; i < lobes.length; i++) {
            var L = lobes[i];
            var ax = Math.sqrt(Math.pow(L.rx * Math.cos(L.rot), 2) + Math.pow(L.ry * Math.sin(L.rot), 2));
            var ay = Math.sqrt(Math.pow(L.rx * Math.sin(L.rot), 2) + Math.pow(L.ry * Math.cos(L.rot), 2));
            if (Math.abs(L.x) + ax > extX) extX = Math.abs(L.x) + ax;
            if (Math.abs(L.y) + ay > extY) extY = Math.abs(L.y) + ay;
        }

        var k = 0.94 / Math.max(extX, extY, 0.001);
        for (i = 0; i < lobes.length; i++) {
            lobes[i].x *= k;
            lobes[i].y *= k;
            lobes[i].rx *= k;
            lobes[i].ry *= k;
        }
        return lobes;
    }

    /* ตัดขอบล่างให้แบน (comic poof) ด้วยการลบแบบนุ่ม -> ไม่มีเส้นแข็ง */
    function flattenBottom(ctx, size, y, soft) {
        var g = ctx.createLinearGradient(0, y - soft, 0, y + soft * 0.5);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, "rgba(0,0,0,1)");
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);      // ทำงานในพิกัด canvas จริง (ไม่เอียงตาม transform ของการวาด)
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = g;
        ctx.fillRect(0, y - soft, size, size - y + soft);
        ctx.restore();
    }

    function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

    function easeInOut(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }

    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

    /* 0 -> 1 -> 0 ในช่วง a..b (ใช้ทำ squash แล้ว stretch) */
    function tri(t, a, b) {
        if (t <= a || t >= b) return 0;
        var u = (t - a) / (b - a);
        return u < 0.5 ? u * 2 : (1 - u) * 2;
    }

    function smoothstep(a, b, t) {
        var u = clamp01((t - a) / (b - a));
        return u * u * (3 - 2 * u);
    }

    /* ใส่ path ของ lobe ทั้งหมด (ยังไม่ fill) */
    function addLobesPath(ctx, lobes, s, dx, dy) {
        ctx.beginPath();
        for (var i = 0; i < lobes.length; i++) {
            var L = lobes[i];
            ctx.ellipse(L.x * s + dx, L.y * s + dy, L.rx * s, L.ry * s, L.rot, 0, Math.PI * 2);
        }
    }

    /* วาด union ของ lobe ทั้งหมดเป็นสีเดียว (path เดียว -> วงรีซ้อนกันกลายเป็นก้อนเดียว) */
    function paintLobes(ctx, lobes, s, dx, dy, fill, blurPx) {
        var useBlur = blurPx > 0.35 && supportsFilter(ctx);
        var soft = blurPx > 0.35 && !useBlur;      // ไม่มี ctx.filter -> จำลองความนุ่มด้วยการทับหลายรอบ
        var passes = soft ? 5 : 1;
        var off = blurPx * 0.55;
        var dirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
        var p;

        ctx.save();
        ctx.fillStyle = fill;
        if (useBlur) ctx.filter = "blur(" + blurPx.toFixed(2) + "px)";
        for (p = 0; p < passes; p++) {
            if (soft) ctx.globalAlpha = 0.5;
            addLobesPath(ctx, lobes, s, dx + dirs[p][0] * off, dy + dirs[p][1] * off);
            ctx.fill();
        }
        ctx.restore();
    }

    /* อบ sprite: 3 แบบต่อ (ระนาบ, variant)
       - "base"  : ก้อนทึบโทนหลัก + หมอกนุ่มรอบนอก (deep)      -> วาดแบบ source-over เป็น "ตัวก้อน"
       - "shade" : ก้อนทึบโทนเข้ม                              -> ทับแบบ source-atop (เฉียงลง-ขวา)
       - "lit"   : ก้อนทึบโทนสว่าง                              -> ทับแบบ source-atop (เฉียงขึ้น-ซ้าย)
       การแยก 3 ชั้นแบบนี้ทำให้ "กองรวม" อ่านเป็นก้อนเดียว (ไม่เห็นเงา/ไฮไลต์ซ้อนกันของแต่ละลูก) */
    function bakeSprite(size, preset, depth, variant, kind) {
        var family = preset.family;
        var level = preset.level;
        var canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext("2d");
        var seed = (Math.imul(variant + 1, 2654435761) ^ Math.imul(depth + 1, 40503) ^
            Math.imul(family.id.charCodeAt(0), 7919) ^ 0x9E3779B1) >>> 0;
        var lobes = makeLobes(family, mulberry32(seed));
        var s = size / 2;
        ctx.translate(s, s);          // สำคัญ: lobe อ้างจาก "ศูนย์กลาง" ของ canvas ไม่ใช่มุมซ้ายบน
        var blur = family.blur[depth] * level.blurK;
        var sh = family.shade;
        var mainTone = kind === "lit" ? "lit" : (kind === "shade" ? "shade" : (depth === 2 ? "lit" : "body"));
        var i;

        if (kind === "base") {
            paintLobes(ctx, lobes, s * 1.045, 0, s * 0.020, tone("deep", 0.30), blur * 2.20);
        }
        paintLobes(ctx, lobes, s * 0.985, -s * 0.022, -s * 0.030, tone(mainTone, 1), blur * (kind === "base" ? 0.30 : 0.20));

        if (kind === "base" && family.rim) {
            ctx.save();
            addLobesPath(ctx, lobes, s * 0.985, -s * 0.022, -s * 0.030);
            ctx.clip();
            ctx.beginPath();
            ctx.rect(-s, -s, size, size * 0.58);    // เฉพาะครึ่งบน -> ไม่กลายเป็นกรอบปิดรอบตัว
            ctx.clip();
            ctx.lineWidth = Math.max(1.2, size * 0.011);
            ctx.lineJoin = "round";
            ctx.strokeStyle = tone("lit", 0.50);
            addLobesPath(ctx, lobes, s * 0.965, -s * 0.020, -s * 0.028);
            ctx.stroke();
            ctx.restore();
            // ทาเนื้อสีทับด้านใน -> เส้นโค้งที่อยู่ "ข้างใน" ก้อนถูกกลบ เหลือไฮไลต์เฉพาะขอบนอก
            ctx.save();
            addLobesPath(ctx, lobes, s * 0.985, -s * 0.022, -s * 0.030);
            ctx.clip();
            paintLobes(ctx, lobes, s * 0.930, -s * 0.018, -s * 0.026, tone("lit", 0.92), blur * 0.30);
            ctx.restore();
        }

        if (kind === "base" && family.flat < 0.995) {
            var bottom = 0;
            for (i = 0; i < lobes.length; i++) {
                var L = lobes[i];
                var ey = Math.sqrt(Math.pow(L.rx * Math.sin(L.rot), 2) + Math.pow(L.ry * Math.cos(L.rot), 2));
                if (L.y + ey > bottom) bottom = L.y + ey;
            }
            flattenBottom(ctx, size, s + bottom * s * family.flat, size * 0.06);
        }
        return canvas;
    }

    /* ---- fill: ตัวคูณ "เติมเต็ม" ต่อ instance (การ์ดทรงกว้าง/เตี้ย เช่นการ์ดเป้า 380x~98) ----
       ทำไมต้องมี: ขนาดก้อนถูกจำกัดด้วย "ความสูง" ของ canvas (unitBase = min(w*0.34, h*0.50))
       -> การ์ดยิ่งกว้าง ควันยิ่งดูไม่เต็มความกว้าง (การ์ดเป้า: ควันไปได้ ±144px ในการ์ด ±190px)
       ไม่ส่ง fill มา = 1 ทุกตัว -> พฤติกรรมเดิมของการ์ด Alert/Latest เป๊ะ (ลุคนั้นห้ามเปลี่ยน)
         spreadX / spreadY = รัศมีการกระจายก้อน (แนวนอน/แนวตั้ง)
         sizeK             = ขนาดก้อน
         countK            = จำนวนก้อนต่อระนาบ (ทับกันมากขึ้น)
         opacityK          = ความทึบรวมของ canvas (ตัวคูณ level.opacity ของพรีเซ็ต) */
    var SMOKE_FILL_KEYS = ["spreadX", "spreadY", "sizeK", "countK", "opacityK"];
    var SMOKE_FILL_NONE = { spreadX: 1, spreadY: 1, sizeK: 1, countK: 1, opacityK: 1 };

    function fillFactor(value) {
        var n = Number(value);
        if (!isFinite(n) || n <= 0) return 1;

        return Math.min(3, Math.max(0.2, n));
    }

    function normalizeFill(fill) {
        var out = {};
        for (var i = 0; i < SMOKE_FILL_KEYS.length; i++) {
            var key = SMOKE_FILL_KEYS[i];
            out[key] = fillFactor(fill ? fill[key] : 1);
        }

        /* โหมด "เส้นรอบกรอบกล้อง" (วิดเจ็ต /cam) — ส่งค่า ring ผ่านเข้าไปด้วย (การ์ดไม่ใช้คีย์นี้) */
        if (fill && fill.ring) out.ring = fill.ring;

        return out;
    }

    /* sizeK ต้องอยู่ในคีย์ด้วย -> สไปรต์ถูกอบที่ความละเอียดที่ใช้จริง (และ cache แยกกัน) */
    function atlasKeyFor(w, h, dpr, sizeK) {
        var sk = fillFactor(sizeK);
        var base = Math.min(w * 0.34, h * 0.50) * SMOKE_ACTIVE.family.sizeK * SMOKE_ACTIVE.level.sizeK * sk;
        var px = Math.ceil((base * 1.70 * dpr) / 64) * 64;
        return Math.max(128, Math.min(576, px)) + "|" + SMOKE_ACTIVE.id + "|" + sk.toFixed(2);
    }

    function buildAtlas(key) {
        if (atlas[key]) return atlas[key];
        var size = Number(String(key).split("|")[0]) || 192;
        var planes = [];
        for (var d = 0; d < 3; d++) {
            var variants = [];
            for (var v = 0; v < SMOKE_VARIANTS; v++) {
                variants.push([
                    bakeSprite(size, SMOKE_ACTIVE, d, v, "base"),
                    bakeSprite(size, SMOKE_ACTIVE, d, v, "lit"),
                    bakeSprite(size, SMOKE_ACTIVE, d, v, "shade")
                ]);
            }
            planes.push(variants);
        }
        atlas[key] = planes;
        return planes;
    }

    /* อุ่น atlas ล่วงหน้า (เรียกจาก prewarmEffects) — ไม่สร้าง instance ไม่เริ่ม loop */
    function warm(canvas, fill) {
        if (!canvas) return;
        var rect = canvas.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        buildAtlas(atlasKeyFor(rect.width, rect.height, window.devicePixelRatio || 1, normalizeFill(fill).sizeK));
    }

    function spawn(canvas, textEl, fill) {
        var inst = {
            canvas: canvas,
            ctx: canvas.getContext("2d"),
            phase: "enter",
            lastPhase: "enter",
            t: 0,
            phaseT: 0,
            w: 0,
            h: 0,
            dpr: 1,
            key: null,
            units: null,
            textBox: null,
            scratch: null,
            sctx: null,
            preset: SMOKE_ACTIVE,
            fill: normalizeFill(fill),      // ตัวคูณการวาง/ขนาด/จำนวนก้อน (การ์ดทรงกว้างส่งค่ามา)
            enterDur: Math.max(0.2, ENTER_MS / 1000),
            exitDur: Math.max(0.2, EXIT_MS / 1000),
            removed: false
        };
        live.push(inst);
        measure(inst, textEl);
        buildUnits(inst);
        startLoop();
        return inst;
    }

    function measure(inst, textEl) {
        var rect = inst.canvas.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        var dpr = window.devicePixelRatio || 1;
        inst.w = rect.width;
        inst.h = rect.height;
        inst.dpr = dpr;
        inst.canvas.width = Math.round(rect.width * dpr);
        inst.canvas.height = Math.round(rect.height * dpr);
        inst.key = atlasKeyFor(rect.width, rect.height, dpr, inst.fill.sizeK);
        if (!textEl) return;
        // กรอบ "ตัวอักษรจริง" (หัก padding ของ .text ออก) -> ใช้ลดความทึบควันเฉพาะจุด
        var tr = textEl.getBoundingClientRect();
        var cs = getComputedStyle(textEl);
        var pl = parseFloat(cs.paddingLeft) || 0;
        var pt = parseFloat(cs.paddingTop) || 0;
        var pr = parseFloat(cs.paddingRight) || 0;
        var pb = parseFloat(cs.paddingBottom) || 0;
        inst.textBox = {
            x0: (tr.left - rect.left + pl) * dpr,
            y0: (tr.top - rect.top + pt) * dpr,
            x1: (tr.right - rect.left - pr) * dpr,
            y1: (tr.bottom - rect.top - pb) * dpr
        };
    }

    function makeUnit(rand, o) {
        return {
            depth: o.depth,
            variant: Math.floor(rand() * SMOKE_VARIANTS) % SMOKE_VARIANTS,
            r: o.r,
            ux: o.ux,
            uy: o.uy,
            alpha: o.alpha,
            delay: o.delay,
            exitDelay: o.exitDelay,
            core: !!o.core,
            rot0: o.rot0,
            rotV: o.rotV,
            speed: o.speed,
            breathAmp: 0.012 + rand() * 0.016,
            breathPer: 2.4 + rand() * 1.2,
            breathPh: rand() * Math.PI * 2,
            driftAmp: 1.0 + rand() * 2.0,
            driftPer: 0.20 + rand() * 0.25,
            driftPh: rand() * Math.PI * 2,
            px: 0, py: 0, sx: 1, sy: 1, g: 1, a: 0, rot: 0, mul: 1
        };
    }

    /* ============================================================
       โหมด "เส้นรอบกรอบกล้อง" (วิดเจ็ต /cam เท่านั้น)
       ------------------------------------------------------------
       ring = { w, h, r, band, out, base } (px CSS)
         w,h  = ขนาดกรอบกล้อง, r = รัศมีมุมกรอบ
         band = ให้หมึกทับเข้าในกรอบได้ไม่เกินกี่ px (ลึกกว่านั้น = กลางกรอบสะอาด)
         out  = ให้หมึกฟุ้งออกนอกเส้นกรอบได้ไม่เกินกี่ px
         base = ขนาดก้อนอ้างอิง (px) -> ก้อนจริง = base × 0.62/0.46/0.32 ตามระนาบ
       ใช้สไปรต์/อนิเมชัน/พรีเซ็ตชุดเดียวกับ Latest/Goal แต่ "วางก้อนตามเส้นรอบกรอบ"
       -> ลุคการ์ดเป๊ะ แต่เกาะรอบกรอบกล้อง (และไม่มีก้อนกลาง = ไม่ทับภาพกล้อง) */
    function ringRadius(ring) {
        return Math.max(0, Math.min(ring.r, ring.w / 2, ring.h / 2));
    }

    function ringLength(ring) {
        var rad = ringRadius(ring);
        var arc = Math.PI * rad / 2;

        return 2 * (Math.max(0, ring.w - 2 * rad) + Math.max(0, ring.h - 2 * rad)) + 4 * arc;
    }

    /* จุดที่ t (0..1) บนเส้นรอบกรอบ + ทิศตั้งฉากที่ชี้ออกนอก (พิกัด canvas px) */
    function ringPoint(inst, ring, t) {
        var ox = (inst.w - ring.w) / 2;
        var oy = (inst.h - ring.h) / 2;
        var rad = ringRadius(ring);
        var sTop = Math.max(0, ring.w - 2 * rad);
        var sSide = Math.max(0, ring.h - 2 * rad);
        var arc = Math.max(0.001, Math.PI * rad / 2);
        var per = ringLength(ring);
        var d = (((t % 1) + 1) % 1) * per;
        var a;

        if (d < sTop) return { x: ox + rad + d, y: oy, nx: 0, ny: -1 };                 // ขอบบน
        d -= sTop;

        if (d < arc) {                                                                  // มุมขวาบน
            a = -Math.PI / 2 + (d / arc) * (Math.PI / 2);
            return { x: ox + ring.w - rad + Math.cos(a) * rad, y: oy + rad + Math.sin(a) * rad, nx: Math.cos(a), ny: Math.sin(a) };
        }
        d -= arc;

        if (d < sSide) return { x: ox + ring.w, y: oy + rad + d, nx: 1, ny: 0 };         // ขอบขวา
        d -= sSide;

        if (d < arc) {                                                                  // มุมขวาล่าง
            a = (d / arc) * (Math.PI / 2);
            return { x: ox + ring.w - rad + Math.cos(a) * rad, y: oy + ring.h - rad + Math.sin(a) * rad, nx: Math.cos(a), ny: Math.sin(a) };
        }
        d -= arc;

        if (d < sTop) return { x: ox + ring.w - rad - d, y: oy + ring.h, nx: 0, ny: 1 }; // ขอบล่าง
        d -= sTop;

        if (d < arc) {                                                                  // มุมซ้ายล่าง
            a = Math.PI / 2 + (d / arc) * (Math.PI / 2);
            return { x: ox + rad + Math.cos(a) * rad, y: oy + ring.h - rad + Math.sin(a) * rad, nx: Math.cos(a), ny: Math.sin(a) };
        }
        d -= arc;

        if (d < sSide) return { x: ox, y: oy + ring.h - rad - d, nx: -1, ny: 0 };        // ขอบซ้าย
        d -= sSide;

        a = Math.PI + (d / arc) * (Math.PI / 2);                                         // มุมซ้ายบน
        return { x: ox + rad + Math.cos(a) * rad, y: oy + rad + Math.sin(a) * rad, nx: Math.cos(a), ny: Math.sin(a) };
    }

    function buildRingUnits(inst) {
        var ring = inst.fill.ring;
        var level = inst.preset.level;
        var family = inst.preset.family;
        var fill = inst.fill;
        var rand = mulberry32(Math.floor(Math.random() * 0xFFFFFFFF) >>> 0);
        var sizes = [0.62, 0.46, 0.32];
        var speeds = [0.55, 1.00, 1.45];
        var base = Math.max(14, ring.base);
        var per = ringLength(ring);
        var mx = inst.w / 2;
        var my = inst.h / 2;
        var units = [];
        var idx = 0, d, i;
        var rad = ringRadius(ring);
        /* ตัวคูณ "จำนวนก้อน" (มาจาก camSmokeCount) — คุมทั้งก้อนตามเส้นกรอบและก้อนเติมมุม
           1 = แน่นแบบเดิม · น้อยลง = ก้อนห่างขึ้น (จำนวนน้อยลง) แต่ขนาดก้อนเท่าเดิม */
        var dens = Math.max(0.2, Math.min(2, Number(fill.countK) || 1));

        /* วางก้อน 1 ใบ: px,py = จุดอ้างอิง (canvas px) · nx,ny = ทิศตั้งฉากที่ชี้ออกนอก */
        function place(depth, px, py, nx, ny, sizeK) {
            var rr = base * sizeK * (0.86 + rand() * 0.30);                   // รัศมีก้อน (px) — ไม่ล็อกขนาด (เม็ดเท่าการ์ดเป๊ะ)
            /* เยื้องเข้า/ออก: บีบให้หมึกไม่เกิน band (ด้านใน) / out (ด้านนอก) */
            var lo = Math.max(-ring.band, rr - ring.band);
            var hi = Math.max(lo, ring.out - rr);
            var dep = depth === 0 ? 0.40 : (depth === 1 ? 0.15 : 0);          // ระนาบหลัง = ออกนอกสุด
            /* ด้านนอก: ไม่ให้หมึกเข้าไปในโซนขอบจาง (out - fade) -> ก้อนต้องเห็นเต็มลูกเสมอ */
            if (hi > lo) hi = Math.max(lo, Math.min(hi, ring.out - ring.fade - rr));
            var off = lo + (hi - lo) * (dep + rand() * (1 - dep));

            units.push(makeUnit(rand, {
                depth: depth,
                r: rr,
                ux: (px - mx) + nx * off,
                uy: (py - my) + ny * off,
                alpha: level.alpha[depth] * (0.86 + rand() * 0.30),
                delay: 0.10 + rand() * 0.16,
                exitDelay: (depth === 0 ? 0 : (depth === 1 ? 0.03 : 0.06)) + rand() * 0.05,
                core: false,
                rot0: (rand() - 0.5) * 0.5,
                rotV: (rand() - 0.5) * family.spin * Math.PI / 180,
                speed: speeds[depth]
            }));
        }

        for (d = 0; d < 3; d++) {
            var gap = base * (d === 0 ? 1.15 : (d === 1 ? 0.98 : 0.84));       // ระยะห่างก้อนตามเส้นกรอบ (แน่น -> ดูเต็ม)
            var n = Math.max(level.count[d], Math.round(per / gap * dens));

            for (i = 0; i < n; i++) {
                var pt = ringPoint(inst, ring, idx * 0.6180339887);

                idx++;
                place(d, pt.x, pt.y, pt.nx, pt.ny, sizes[d]);
            }
        }

        /* ---- เติม "มุม" ให้เต็ม ----
           ก้อนตามเส้นโค้งมุมจะเหลือพื้นที่มุมเหลี่ยม (ระหว่างเส้นโค้งกับมุมเหลี่ยม) ว่าง
           -> เติมก้อนให้ทั่ว "ลิ่มมุม" ด้านนอกเส้นโค้ง (แนวทแยง 45° + เยื้องตั้งฉาก)
           หมายเหตุ: วางที่ u >= 1 (นอกเส้นโค้ง) เสมอ -> หมึกด้านในกรอบยังไม่เกิน band */
        if (rad > 8) {
            var ox = (inst.w - ring.w) / 2;
            var oy = (inst.h - ring.h) / 2;
            var corners = [
                { cx: ox + rad, cy: oy + rad, sx: -1, sy: -1 },                        // ซ้ายบน
                { cx: ox + ring.w - rad, cy: oy + rad, sx: 1, sy: -1 },                // ขวาบน
                { cx: ox + ring.w - rad, cy: oy + ring.h - rad, sx: 1, sy: 1 },        // ขวาล่าง
                { cx: ox + rad, cy: oy + ring.h - rad, sx: -1, sy: 1 }                 // ซ้ายล่าง
            ];
            var diag = Math.SQRT1_2;
            var fills = Math.max(dens >= 1 ? 3 : 2,                                    // กี่ก้อนต่อระนาบ/มุม
                Math.round((rad * 0.95) / (base * 1.10) * dens));
            var c, k, dd, u, p, tx, ty, uMax;

            for (c = 0; c < corners.length; c++) {
                k = corners[c];
                /* ขอบเขตการฟุ้งตามแนวทแยง: ต้องไม่เลยขอบ canvas (มิเตอร์เดียวกับด้านตรง)
                   -> ระยะเกินเส้นโค้ง (u-1)*rad*cos45 + รัศมีพัฟใหญ่สุด ต้องไม่เกิน out */
                uMax = 1 + Math.max(0.04, ((ring.out - ring.band) * 0.5) / Math.max(6, rad * Math.SQRT1_2));

                for (i = 0; i < fills * 3; i++) {
                    dd = i % 3;
                    u = 1.02 + rand() * Math.max(0.03, uMax - 1.02);                   // ระยะตามแนวทแยง (×รัศมีมุม) = ลิ่มมุมด้านนอกเส้นโค้ง
                    p = (rand() - 0.5) * rad * 0.75;                                   // เยื้องตั้งฉากกับแนวทแยง -> กระจายทั่วลิ่ม
                    tx = -k.sy * diag;
                    ty = k.sx * diag;
                    place(dd, k.cx + k.sx * diag * rad * u + tx * p, k.cy + k.sy * diag * rad * u + ty * p,
                        k.sx * diag, k.sy * diag, sizes[dd] * 1.02);
                }
            }
        }

        inst.units = units;
        inst.unitBase = base;
    }

    /* วางก้อนทั้ง 3 ระนาบ: back = ใหญ่/ไกล/ช้า , mid = กลาง , front = เล็ก/ใกล้/เร็ว (2.5D) */
    function buildUnits(inst) {
        if (inst.fill && inst.fill.ring) {      // วิดเจ็ตกรอบกล้อง -> วางตามเส้นรอบกรอบ (ไม่มีก้อนกลาง)
            buildRingUnits(inst);
            return;
        }

        var preset = inst.preset;
        var level = preset.level;
        var family = preset.family;
        var fill = inst.fill || SMOKE_FILL_NONE;
        var rand = mulberry32(Math.floor(Math.random() * 0xFFFFFFFF) >>> 0);
        var mx = inst.w / 2;
        var my = inst.h / 2;
        var extX = mx * 0.62 * level.spread * family.extKX * fill.spreadX;
        var extY = my * 0.60 * level.spread * family.extKY * fill.spreadY;
        var unitBase = Math.min(inst.w * 0.34, inst.h * 0.50) * family.sizeK * level.sizeK * fill.sizeK;
        var sizes = [0.62, 0.46, 0.32];
        var speeds = [0.55, 1.00, 1.45];
        var golden = 2.399963;
        var units = [];
        var idx = 0, d, i, ang, rr;

        /* ก้อนกลาง: ไอเล็ก ๆ ที่ผุดขึ้นก่อน -> โตขึ้นหน่อย -> เป็นก้อนสุดท้ายที่หุบกลับเข้าศูนย์ */
        units.push(makeUnit(rand, {
            depth: 2, r: unitBase * sizes[2] * 0.62, ux: 0, uy: 0,
            alpha: level.alpha[2] * 0.86, delay: 0, exitDelay: 0.12, core: true,
            rot0: (rand() - 0.5) * 0.4, rotV: 0, speed: speeds[2]
        }));

        for (d = 0; d < 3; d++) {
            for (i = 0; i < Math.max(1, Math.round(level.count[d] * fill.countK)); i++) {
                /* การ์ดทรงกว้าง: ปักก้อนไกลสุด 2 ก้อนไว้ที่ซ้าย/ขวาแนวกลางเป๊ะ
                   -> ควันไปสุดขอบการ์ดทั้ง 2 ข้างเสมอ ไม่ขึ้นกับการสุ่ม (ผลวัดจริงจึงนิ่ง) */
                if (d === 0 && i < 2 && fill.spreadX > 1) {
                    ang = i === 0 ? 0 : Math.PI;
                    idx++;
                    rr = 0.98;
                } else {
                    ang = idx * golden + d * 0.6 + rand() * 0.35;
                    idx++;
                    rr = d === 0 ? 0.78 + rand() * 0.22 : (d === 1 ? 0.45 + rand() * 0.35 : 0.18 + rand() * 0.34);
                }
                units.push(makeUnit(rand, {
                    depth: d,
                    r: unitBase * sizes[d] * (0.86 + rand() * 0.30),
                    ux: Math.cos(ang) * extX * rr,
                    uy: Math.sin(ang) * extY * rr,
                    alpha: level.alpha[d] * (0.86 + rand() * 0.30),
                    delay: (d === 0 ? 0.16 : (d === 1 ? 0.24 : 0.32)) + rand() * 0.22,
                    exitDelay: (d === 0 ? 0 : (d === 1 ? 0.03 : 0.06)) + rand() * 0.05,
                    core: false,
                    rot0: (rand() - 0.5) * 0.5,
                    rotV: (rand() - 0.5) * family.spin * Math.PI / 180,
                    speed: speeds[d]
                }));
            }
        }

        inst.units = units;
        inst.unitBase = unitBase;
    }

    function startLoop() {
        if (rafId == null) {
            last = 0;
            rafId = requestAnimationFrame(loop);
        }
    }

    function loop(now) {
        if (now === undefined) {
            rafId = requestAnimationFrame(loop);
            return;
        }
        var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
        last = now;

        for (var i = live.length - 1; i >= 0; i--) {
            if (live[i].removed) {
                live.splice(i, 1);
                continue;
            }
            step(live[i], dt);
        }

        if (live.length === 0) {
            rafId = null;
            last = 0;
            return;
        }
        rafId = requestAnimationFrame(loop);
    }

    function drawUnit(g, u, planes, kind, ox, oy, alpha) {
        var sprite = planes[u.depth][u.variant][kind];
        var d = u.r * 2;
        g.save();
        g.translate(u.px + ox, u.py + oy);
        g.rotate(u.rot);
        g.scale(u.sx * u.g, u.sy * u.g);
        g.globalAlpha = alpha;
        g.drawImage(sprite, -d / 2, -d / 2, d, d);
        g.restore();
    }

    /* คีย์เฟรม: enter = โผล่กลาง -> กระเพื่อมออก (squash แล้ว stretch)
                idle  = หายใจ/ลอย/หมุนช้า ๆ
                exit  = หุบกลับเข้าศูนย์ + บี้แบน -> ก้อนสุดท้ายหุบหาย */
    function step(inst, dt) {
        inst.t += dt;

        if (inst.phase !== inst.lastPhase) {
            inst.lastPhase = inst.phase;
            inst.phaseT = 0;
        }
        inst.phaseT += dt;

        var ctx = inst.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, inst.canvas.width, inst.canvas.height);
        if (inst.w < 2 || inst.h < 2 || !inst.units) return;

        var family = inst.preset.family;
        var level = inst.preset.level;
        var fill = inst.fill || SMOKE_FILL_NONE;
        var planes = atlas[inst.key] || buildAtlas(inst.key);
        var enterU = inst.phase === "enter" ? clamp01(inst.phaseT / inst.enterDur) : 1;
        var exitU = inst.phase === "exit" ? clamp01(inst.phaseT / inst.exitDur) : 0;
        var mx = inst.w / 2;
        var my = inst.h / 2;
        var t = inst.t;
        var rise = (inst.fill && inst.fill.ring) ? 0 : family.rise * Math.min(t, 2.0) * 5;   // กรอบกล้อง = ไม่ลอยขึ้น
        var i, u;

        /* ---- 1) คีย์เฟรม: ตำแหน่ง/สเกล/อัลฟา ของทุกก้อน ---- */
        for (i = 0; i < inst.units.length; i++) {
            u = inst.units[i];
            var k = 1, g = 1, a = u.alpha, sx = 1, sy = 1;
            var ed, bp, sq;

            if (inst.phase === "exit") {
                ed = clamp01((exitU - u.exitDelay) / (1 - u.exitDelay));
                k = 1 - 0.95 * Math.pow(ed, 2.4);                       // หุบเข้าศูนย์กลาง
                g = 1 - (u.core ? 0.92 : 0.45) * easeInOut(ed);          // ย่อตัวเองลง
                a = u.alpha * (1 - smoothstep(u.core ? 0.52 : 0.26, 1, ed));
                sq = tri(ed, 0.08, 0.92) * family.squash * 0.85;         // บี้แบนตอนถูกดูดกลับ
                sx = 1 + sq;
                sy = 1 - sq * 0.9;
            } else if (inst.phase === "enter") {
                ed = clamp01((enterU - u.delay) / Math.max(0.08, 1 - u.delay));
                k = easeOutCubic(clamp01(ed / 0.60));                    // กระจายออกจากกลาง
                g = u.core
                    ? 0.07 + 0.93 * easeOutQuint(clamp01(ed / 0.36))     // ไอที่กลาง: โผล่เล็ก ๆ -> โต
                    : 0.16 + 0.90 * easeOutQuint(clamp01(ed / 0.52));
                g *= 1 + family.over * Math.sin(Math.PI * clamp01(ed / 0.72));
                sq = family.squash;
                sx = 1 + sq * (tri(ed, 0.06, 0.34) - 0.55 * tri(ed, 0.40, 0.74));
                sy = 1 - sq * 0.95 * tri(ed, 0.06, 0.34) + sq * 0.60 * tri(ed, 0.40, 0.74);
                a = u.alpha * clamp01((ed - 0.02) / 0.32);
            } else {
                bp = (Math.PI * 2 * t) / u.breathPer + u.breathPh;
                k = 1 + 0.012 * Math.sin(bp);
                g = 1 + u.breathAmp * Math.sin(bp);
                sx = 1 + u.breathAmp * 0.6 * Math.cos(bp);
                sy = 1 - u.breathAmp * 0.6 * Math.cos(bp);
                a = u.alpha * (1 + 0.05 * Math.sin(bp * 0.7));
            }

            u.px = mx + u.ux * k + Math.cos(t * u.driftPer * u.speed + u.driftPh) * u.driftAmp;
            u.py = my + u.uy * k + Math.sin(t * u.driftPer * u.speed * 1.25 + u.driftPh) * u.driftAmp - rise;
            u.sx = sx;
            u.sy = sy;
            u.g = g;
            u.a = a;
            u.rot = u.rot0 + u.rotV * t;
            /* อัลฟาสัมพัทธ์ 0..1 (ตอน idle = 1 -> กองรวมทึบเป็นก้อนเดียว ไม่เห็นขอบทับกันของแต่ละลูก) */
            u.rel = clamp01(a / Math.max(0.001, u.alpha)) * PLANE_REL[u.depth];
        }

        /* ---- 2) ประกอบ "กองเดียว" ใน layer ชั่วคราว: ตัวก้อน -> เงา -> ไฮไลต์ (ทิศแสงเดียวทั้งกอง) ---- */
        var scratch = inst.scratch;
        if (!scratch || scratch.width !== inst.canvas.width || scratch.height !== inst.canvas.height) {
            if (!scratch) {
                scratch = document.createElement("canvas");
                inst.scratch = scratch;
                inst.sctx = scratch.getContext("2d");
            }
            scratch.width = inst.canvas.width;
            scratch.height = inst.canvas.height;
        }
        var sctx = inst.sctx;
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.clearRect(0, 0, scratch.width, scratch.height);
        sctx.globalAlpha = 1;
        sctx.globalCompositeOperation = "source-over";
        sctx.scale(inst.dpr, inst.dpr);

        var ox = inst.w * 0.016;
        var oy = inst.h * 0.022;

        for (i = 0; i < inst.units.length; i++) {
            u = inst.units[i];
            if (u.rel > 0.004) drawUnit(sctx, u, planes, 0, 0, 0, u.rel);
        }
        sctx.globalCompositeOperation = "source-atop";
        for (i = 0; i < inst.units.length; i++) {
            u = inst.units[i];
            if (u.rel > 0.004) drawUnit(sctx, u, planes, 2, ox, oy, u.rel * SHADE_A);
        }
        for (i = 0; i < inst.units.length; i++) {
            u = inst.units[i];
            if (u.rel > 0.004) drawUnit(sctx, u, planes, 1, -ox, -oy, u.rel * LIT_A);
        }
        sctx.globalCompositeOperation = "source-over";

        /* ---- 3) รวมลง canvas จริง: อัลฟาตามระดับความเข้ม + ลดความทึบในกรอบตัวอักษร ---- */
        ctx.globalAlpha = clamp01(level.opacity * fill.opacityK);
        ctx.drawImage(scratch, 0, 0);
        ctx.globalAlpha = 1;

        /* ---- 3.1) กรอบกล้อง (โหมด ring): ขอบ canvas ต้อง "จางหายไป" ไม่ให้เห็นรอยตัดเป็นเส้นตรง
           ลบหมึกช่วงริม canvas ด้วย gradient ทึบ -> โปร่ง ทั้ง 4 ด้าน (destination-out)
           -> ควันละลายหายไปก่อนถึงขอบ · ตัวกรอบ/แสงเรืองเป็น DOM จึงไม่โดนลบ
           และทั้งหมดวาดใน canvas ล้วน (ไม่ใช้ CSS mask / ไม่กินการ์ดใบอื่น) ---- */
        if (inst.fill && inst.fill.ring) {
            var cw = inst.canvas.width, ch = inst.canvas.height;
            var lw = (inst.fill.ring.fade || 12) * inst.dpr;                   // ความกว้างโซนจาง (CSS px -> device px)
            lw = Math.min(lw, Math.min(cw, ch) * 0.12);
            var gT = ctx.createLinearGradient(0, 0, 0, lw);
            var gB = ctx.createLinearGradient(0, ch, 0, ch - lw);
            var gL = ctx.createLinearGradient(0, 0, lw, 0);
            var gR = ctx.createLinearGradient(cw, 0, cw - lw, 0);
            var sides = [[gT, 0, 0, cw, lw], [gB, 0, ch - lw, cw, lw], [gL, 0, 0, lw, ch], [gR, cw - lw, 0, lw, ch]];
            var si, sg;

            ctx.save();
            ctx.globalCompositeOperation = "destination-out";
            ctx.globalAlpha = 1;

            for (si = 0; si < sides.length; si++) {
                sg = sides[si][0];
                sg.addColorStop(0, "rgba(0,0,0,1)");
                sg.addColorStop(1, "rgba(0,0,0,0)");
                ctx.fillStyle = sg;
                ctx.fillRect(sides[si][1], sides[si][2], sides[si][3], sides[si][4]);
            }
            ctx.restore();
        }

        if (inst.textBox && level.cap < 0.999 && supportsFilter(ctx)) {
            var tb = inst.textBox;
            var pad = 8 * inst.dpr;
            ctx.save();
            ctx.globalCompositeOperation = "destination-out";
            ctx.globalAlpha = 1 - level.cap;
            ctx.filter = "blur(" + (14 * inst.dpr).toFixed(1) + "px)";
            ctx.fillStyle = "#000";
            ctx.fillRect(tb.x0 - pad, tb.y0 - pad * 0.5,
                (tb.x1 - tb.x0) + pad * 2, (tb.y1 - tb.y0) + pad);
            ctx.restore();
        }
    }

    function release(inst) {
        if (inst) inst.removed = true;
    }

    /* (dev เท่านั้น: ?smokedev=1) คืน data URL ของ sprite sheet 3x3 (ระนาบ x variant) เพื่อตรวจทรง */
    function spriteSheet() {
        var key = (live.length && live[0].key) ? live[0].key : null;
        if (!key) {
            var probe = document.querySelector(".smoke");
            var rect = probe ? probe.getBoundingClientRect() : null;
            key = (rect && rect.width > 2) ? atlasKeyFor(rect.width, rect.height, window.devicePixelRatio || 1)
                : atlasKeyFor(589, 301, 1);
        }
        var planes = atlas[key] || buildAtlas(key);
        var n = planes[0][0][0].width;
        var sheet = document.createElement("canvas");
        sheet.width = n * 3;
        sheet.height = n * 3;
        var sctx = sheet.getContext("2d");
        for (var d = 0; d < 3; d++) {
            for (var v = 0; v < planes[d].length; v++) sctx.drawImage(planes[d][v][0], v * n, d * n);
        }
        return sheet.toDataURL("image/png");
    }

    /* (dev) bbox ของ alpha ใน sprite แต่ละใบ -> ตรวจว่าเนื้ออยู่ในกรอบจริง */
    function spriteProbe() {
        var key = atlasKeyFor(589, 301, 1);
        var planes = atlas[key] || buildAtlas(key);
        var out = [];
        for (var d = 0; d < 3; d++) {
            for (var v = 0; v < planes[d].length; v++) {
                for (var k = 0; k < 3; k++) {
                    var cv = planes[d][v][k];
                    var W = cv.width, H = cv.height;
                    var data = cv.getContext("2d").getImageData(0, 0, W, H).data;
                    var x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
                    for (var y = 0; y < H; y++) {
                        for (var x = 0; x < W; x++) {
                            if (data[(y * W + x) * 4 + 3] > 40) {
                                n++;
                                if (x < x0) x0 = x;
                                if (x > x1) x1 = x;
                                if (y < y0) y0 = y;
                                if (y > y1) y1 = y;
                            }
                        }
                    }
                    out.push({ d: d, v: v, k: k, w: W, h: H, bbox: [x0, y0, x1, y1], px: n });
                }
            }
        }
        return out;
    }

    /* ข้อมูลสำหรับเทส/diag (ไม่กระทบการวาด) */
    function debugState() {
        var list = [];
        for (var i = 0; i < live.length; i++) {
            list.push({
                t: Math.round(live[i].t * 1000) / 1000,
                phase: live[i].phase,
                phaseT: Math.round(live[i].phaseT * 1000) / 1000,
                units: live[i].units ? live[i].units.length : 0,
                fill: live[i].fill || null
            });
        }
        return {
            preset: SMOKE_ACTIVE.id,
            label: SMOKE_ACTIVE.label,
            presets: Object.keys(SMOKE_PRESETS),
            atlas: Object.keys(atlas),
            live: list
        };
    }

    return {
        spawn: spawn, release: release, warm: warm, debug: debugState,
        // วัดกรอบข้อความใหม่ (ใช้ตอนข้อความในการ์ดเปลี่ยน เช่น ชื่อ Follower คนใหม่)
        remeasure: measure,
        /* วัดใหม่ + วางก้อนใหม่ (ใช้ตอนกรอบเปลี่ยนขนาด เช่น วิดเจ็ตกรอบกล้อง) */
        rebuild: function (inst, textEl) { measure(inst, textEl); buildUnits(inst); },
        sheet: SMOKE_DEV ? spriteSheet : null, probe: SMOKE_DEV ? spriteProbe : null
    };
})();

    global.StreamSmoke = Smoke;
})(window);
