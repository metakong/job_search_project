// =====================================================================
// Years-of-Experience / "Highest & Best Use" Profiler — yoe-profiler.js
// =====================================================================
// Turns a résumé into the candidate's SIGNATURE: cumulative years per skill,
// distilled to the top hard + top soft skills = their "highest & best use".
//
// HOW (validated in tools/yoe-spike.mjs against the real résumé):
//   1. Slice the résumé into dated roles (title window + bullets, bounded by the
//      previous date anchor so a role's text never bleeds into its neighbour).
//   2. Attribute each role's DURATION to the curated skills demonstrated in it —
//      using the app's OWN vocabulary (competency-profiler domains + a soft
//      lexicon), NOT an external taxonomy (ESCO/O*NET literal matching measured
//      too noisy — see PROJECT_PROGRESS Phase 14.0–14.2).
//   3. Honesty guards, each fixing a real bug the spike caught:
//      • PROMINENCE gate — a skill counts for a role only if it's a concrete
//        SIGNAL term, OR appears ≥2×, OR is named in the title. Kills incidental
//        inflation (one stray "payroll" no longer grants 12 years of "finance").
//      • WEIGHTED calendar-union — overlapping roles don't double-count a month;
//        months covered only by SELF-EMPLOYMENT count at 0.6 (recruiter-discount,
//        same principle as the dual-baseline seniority anchor). A month also
//        covered by a W-2 role counts at full weight.
//   Deterministic, browser-native, zero external deps.
// =====================================================================

(function () {
    'use strict';

    const SELF_EMP_WEIGHT = 0.6;   // self-employed months are recruiter-discounted
    const MIDX = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
    const DATE_RE = new RegExp(`(${MON})?\\s*((?:19|20)\\d{2})\\s*(?:–|—|-|to|through|until)\\s*(?:(present|current)|(${MON})?\\s*((?:19|20)\\d{2}))`, 'ig');
    // Tight self-employment signal — deliberately EXCLUDES bare "LLC" (real
    // employers are LLCs too; the spike false-flagged "AP Wireless … LLC").
    const SELF_EMP = /self.?employed|\bfounder\b|co.?founder|\b1099\b|freelance|sole proprietor|principal consultant|owner.?operator/i;

    // Soft skills as stemmed patterns (the spike found ZERO with exact words:
    // "mentor"≠"mentoring", "renegotiations"≠"negotiation", and they live in the
    // summary header). Start-boundary stems catch the morphology.
    const SOFT = [
        ['leadership',            /\b(lead(ership|ing)?|led|director|directed|spearhead|championed)/i],
        ['mentoring & coaching',  /\b(mentor|coach|train(ed|ing|s)?\b)/i],
        ['negotiation',           /negotiat/i],
        ['communication',         /\bcommunicat/i],
        ['collaboration & teamwork', /\b(collaborat|teamwork|cross.?functional|team lead)/i],
        ['adaptability',          /\b(adaptab|versatil|pivot(ed|ing)?)/i],
        ['problem solving',       /\b(problem.solving|troubleshoot|resolv)/i],
        ['strategy',              /\bstrateg/i],
        ['organization',          /\b(organiz|organis|coordinat)/i],
        ['initiative',            /\b(initiativ|proactiv|self.start)/i],
    ];

    function cleanLabel(t) { return t.replace(/\\b/g, '').replace(/\\/g, '').trim(); }
    function compile(t, global) {
        // Terms already written as regex (e.g. "\bsdr\b", "c\+\+") are used verbatim.
        if (t.includes('\\')) return new RegExp(t, global ? 'ig' : 'i');
        const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sb = /^[a-z0-9]/i.test(t) ? '\\b' : '';
        const eb = /[a-z0-9]$/i.test(t) ? '\\b' : '';
        return new RegExp(`${sb}${esc}${eb}`, global ? 'ig' : 'i');
    }

    let HARD = null;   // lazy: needs competency-profiler loaded
    function hardVocab() {
        if (HARD) return HARD;
        HARD = [];
        const DOMAINS = (window.competencyProfiler && window.competencyProfiler.DOMAINS) || {};
        for (const [domain, def] of Object.entries(DOMAINS)) {
            for (const t of (def.signal  || [])) HARD.push({ label: cleanLabel(t), domain, isSignal: true,  re: compile(t), reG: compile(t, true) });
            for (const t of (def.context || [])) HARD.push({ label: cleanLabel(t), domain, isSignal: false, re: compile(t), reG: compile(t, true) });
        }
        return HARD;
    }

    // Slice résumé → [{ title, window, interval:[startYr, endYr], selfEmp }] (most recent first).
    function parseRoles(text) {
        const now = new Date();
        const nowVal = now.getFullYear() + now.getMonth() / 12;
        const mi = s => s ? (MIDX[s.slice(0, 3).toLowerCase()] ?? 0) : 0;
        const matches = [];
        let m;
        DATE_RE.lastIndex = 0;
        while ((m = DATE_RE.exec(text)) !== null) {
            matches.push({
                idx: m.index, end: m.index + m[0].length,
                sV: (+m[2]) + mi(m[1]) / 12,
                eV: m[3] ? nowVal : (+m[5]) + mi(m[4]) / 12,
            });
        }
        const roles = [];
        for (let i = 0; i < matches.length; i++) {
            const d = matches[i];
            const title = text.substring(i === 0 ? 0 : matches[i - 1].end, d.idx).replace(/\s+/g, ' ').trim().slice(-90);
            const window = title + ' ' + text.substring(d.end, i + 1 < matches.length ? matches[i + 1].idx : text.length);
            if (d.eV > d.sV) roles.push({ title, window, interval: [d.sV, d.eV], selfEmp: SELF_EMP.test(title) });
        }
        return roles;
    }

    // Weighted union of [start, end, weight] intervals (years). Overlap counts once
    // at the MAX covering weight, so a self-emp month also covered by a W-2 role
    // is credited at full weight.
    function weightedUnionYears(intervals) {
        if (!intervals.length) return 0;
        const pts = Array.from(new Set(intervals.flatMap(([s, e]) => [s, e]))).sort((a, b) => a - b);
        let total = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            if (b <= a) continue;
            let w = 0;
            for (const [s, e, wt] of intervals) if (s <= a && e >= b) w = Math.max(w, wt);
            total += (b - a) * w;
        }
        return total;
    }

    const yoeProfiler = {
        // Returns { hard:[{skill,years}], soft:[{skill,years}], domains:[{domain,years}],
        //           roleCount, totalYears }  (empty-safe).
        computeProfile(resumeText) {
            const empty = { hard: [], soft: [], domains: [], roleCount: 0, totalYears: 0 };
            if (!resumeText || resumeText.trim().length < 50) return empty;
            const roles = parseRoles(resumeText);
            if (!roles.length) return empty;

            const hard = hardVocab();
            const hardIv = new Map(), softIv = new Map(), domIv = new Map();
            const push = (map, k, iv) => { let a = map.get(k); if (!a) { a = []; map.set(k, a); } a.push(iv); };

            for (const r of roles) {
                const w = r.selfEmp ? SELF_EMP_WEIGHT : 1.0;
                const iv = [r.interval[0], r.interval[1], w];
                const seenDom = new Set();
                for (const h of hard) {
                    const inTitle = h.re.test(r.title);
                    const n = (r.window.match(h.reG) || []).length;
                    const present = inTitle || n >= 1;
                    if (present && (inTitle || h.isSignal || n >= 2)) {          // PROMINENCE gate
                        push(hardIv, h.label, iv);
                        if (!seenDom.has(h.domain)) { push(domIv, h.domain, iv); seenDom.add(h.domain); }
                    }
                }
                for (const [label, pat] of SOFT) if (pat.test(r.window)) push(softIv, label, iv);
            }

            const rank = map => Array.from(map.entries())
                .map(([skill, ivs]) => ({ skill, years: Math.round(weightedUnionYears(ivs) * 10) / 10 }))
                .filter(x => x.years > 0)
                .sort((a, b) => b.years - a.years);

            const totalYears = Math.round(weightedUnionYears(roles.map(r => [r.interval[0], r.interval[1], r.selfEmp ? SELF_EMP_WEIGHT : 1.0])) * 10) / 10;

            return {
                hard: rank(hardIv).slice(0, 10),
                soft: rank(softIv).slice(0, 10),
                domains: rank(domIv).map(d => ({ domain: d.skill, years: d.years })).slice(0, 10),
                roleCount: roles.length,
                totalYears,
            };
        },
    };

    window.yoeProfiler = yoeProfiler;
    console.log('[YoE Profiler] Module loaded.');
})();
