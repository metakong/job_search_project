// =====================================================================
// Competency / Domain Profiler — competency-profiler.js
// =====================================================================
// WHY THIS EXISTS
// A flat, symmetric keyword overlap (skill-matcher) can't tell a candidate's
// *domain* from a job's domain. A sales/ops résumé that happens to contain AI
// buzzwords ("systems", "AI", "red team", "pipeline", "architecture") scores a
// false 80–100% "fit" against real software-engineering / data-science postings,
// because those words collide. That is the single biggest sorting defect for
// non-linear candidates (a sales exec with a hobby-AI background is NOT a
// software engineer).
//
// This module classifies BOTH the résumé and each job into weighted competency
// DOMAINS using *concrete, discriminative* skill terms (named tools, languages,
// certifications — NOT generic buzzwords), then produces a compatibility
// multiplier that damps a job's Delta-X when its domain is one the candidate has
// little real standing in. The candidate's own résumé — not the search
// categories they ticked — is the ground truth for "what am I actually?".
//
// It is deliberately keyword-structured (works offline, zero-download, for ANY
// candidate). The opt-in semantic embedder remains an additional booster.
// =====================================================================

(function () {
    'use strict';

    // Each domain lists SIGNAL terms (concrete, high-confidence skills — weight 2)
    // and CONTEXT terms (supporting — weight 1). Generic words ("system", "data",
    // "management", "pipeline", "automation", "AI") are intentionally EXCLUDED to
    // avoid cross-domain collisions. Collision-prone terms are assigned to a single
    // domain (e.g. "red team" → security only; "coding" is NOT software_eng).
    const DOMAINS = {
        sales: {
            signal: ['salesforce', 'hubspot', 'salesloft', 'outreach.io', 'quota', 'territory',
                'prospecting', 'cold call', 'cold outreach', 'account executive', '\\bsdr\\b', '\\bbdr\\b',
                'business development', 'revenue operations', 'revops', 'go-to-market', 'gtm',
                'book of business', 'sales cycle', 'consultative sell', 'consultative sales', 'upsell',
                'cross-sell', 'quota-carrying', 'net new logos', 'closing deals', 'sales quota'],
            context: ['b2b', 'b2c', 'crm', 'commission', 'arr', 'mrr', 'account management', 'demo',
                'discovery call', 'sales', 'client acquisition', 'negotiation', 'deal']
        },
        operations: {
            signal: ['standard operating procedure', '\\bsop\\b', '\\bsops\\b', 'process improvement',
                'six sigma', 'lean manufacturing', 'kaizen', 'supply chain', 'procurement', 'logistics',
                'inventory management', 'fulfillment', 'vendor management', 'capacity planning',
                'continuous improvement', 'operations management', 'p&l', 'p and l'],
            context: ['operations', 'workflow', 'throughput', 'distribution', 'warehouse', 'scheduling',
                'process', 'efficiency']
        },
        automation_nocode: {
            signal: ['zapier', 'power automate', '\\bn8n\\b', 'make.com', 'integromat', 'airtable',
                'google apps script', 'no-code', 'low-code', 'workflow automation'],
            context: ['integration', 'automation platform', 'rpa']
        },
        software_eng: {
            signal: ['\\bpython\\b', '\\bjava\\b', 'javascript', 'typescript', 'c\\+\\+', 'c#', 'golang',
                '\\bgo\\b lang', '\\bruby\\b', '\\bphp\\b', '\\brust\\b', 'kotlin', '\\bswift\\b',
                'react', 'angular', 'vue', 'node.js', 'nodejs', 'django', 'spring boot', '\\.net\\b',
                'backend', 'front-end', 'frontend', 'full stack', 'full-stack', 'rest api', 'graphql',
                'microservices', 'kubernetes', 'docker', 'terraform', 'ci/cd', 'devops', 'sdk',
                'unit test', 'object-oriented', 'data structures', 'software development', 'software engineer'],
            context: ['\\bapi\\b', '\\baws\\b', 'azure', '\\bgcp\\b', '\\bgit\\b', 'compiler', 'debugging',
                'code review', 'algorithms', 'programming']
        },
        data_ml: {
            signal: ['machine learning', 'deep learning', 'neural network', 'pytorch', 'tensorflow',
                'scikit-learn', 'pandas', 'numpy', 'data scientist', 'model training', 'feature engineering',
                'computer vision', 'mlops', 'xgboost', 'random forest', 'data engineering', 'apache spark'],
            context: ['\\bnlp\\b', 'statistics', 'regression', 'classification', '\\betl\\b', 'hadoop', 'data pipeline']
        },
        product: {
            signal: ['product manager', 'product owner', 'product roadmap', 'user stories', 'jira',
                'mixpanel', 'amplitude', 'a/b testing', 'product strategy', '\\bsdlc\\b', 'product-market fit',
                'product management'],
            context: ['roadmap', 'backlog', 'sprint', 'wireframe', '\\bprd\\b', 'user research']
        },
        marketing: {
            signal: ['\\bseo\\b', '\\bsem\\b', '\\bppc\\b', 'google ads', 'content marketing', 'demand generation',
                'growth marketing', 'marketing automation', 'paid media', 'marketo', 'google analytics',
                'email marketing', 'social media marketing'],
            context: ['brand', 'campaign', 'copywriting', 'influencer', 'marketing']
        },
        finance_acct: {
            signal: ['accounts payable', 'accounts receivable', '\\bgaap\\b', 'financial modeling', 'fp&a',
                '\\bcpa\\b', 'quickbooks', 'general ledger', 'reconciliation', 'bookkeeping', 'netsuite',
                'accounting', 'accounts payables'],
            context: ['audit', 'invoicing', 'payroll', 'tax', 'budgeting', 'financial']
        },
        design: {
            signal: ['ux design', 'ui design', 'figma', 'sketch app', 'adobe photoshop', 'adobe illustrator',
                'design system', 'interaction design', 'visual design', 'prototyping'],
            context: ['wireframe', 'typography', 'user experience']
        },
        hr_recruiting: {
            signal: ['talent acquisition', 'recruiting', 'sourcing candidates', 'applicant tracking',
                'hris', 'people operations', 'employee relations', 'benefits administration'],
            context: ['onboarding', 'recruiter', 'human resources']
        },
        customer_support: {
            signal: ['customer success', 'customer support', '\\bcsm\\b', 'help desk', 'zendesk',
                'client success', 'churn', 'retention', 'technical support'],
            context: ['ticketing', '\\bsla\\b', 'account manager', 'support']
        },
        ai_eval: {
            signal: ['large language model', '\\bllm\\b', '\\bllms\\b', 'chain-of-thought', 'chain of thought',
                '\\bcot\\b', 'rubric', 'data annotation', '\\brlhf\\b', 'prompt engineering',
                'model evaluation', 'reasoning validation', 'ai evaluator', 'ai trainer', 'adversarial prompt'],
            context: ['prompt', 'annotation', 'human feedback', 'model output']
        },
        industrial_eng: {
            signal: ['steam turbine', 'power generation', 'mechanical engineering', 'electrical engineering',
                'civil engineering', '\\bcad\\b', 'solidworks', '\\bplc\\b', '\\bhvac\\b', 'manufacturing engineering',
                'field engineer', 'substation', 'water treatment', 'power systems', 'high voltage', 'grid integration',
                'transmission line'],
            context: ['engineering degree', 'turbine', 'power grid', 'commissioning']
        },
        security: {
            signal: ['offensive security', 'penetration testing', 'pentest', 'red team', 'vulnerability',
                'exploit', '\\bsiem\\b', 'incident response', 'threat intelligence', 'cybersecurity',
                '\\bowasp\\b', 'malware analysis', 'soc analyst'],
            context: ['firewall', 'security engineer', 'threat', 'attacker']
        },
        clinical_health: {
            signal: ['registered nurse', '\\brn\\b', 'patient care', 'phlebotomy', '\\bbls\\b', '\\bacls\\b',
                'electronic health record', '\\bemr\\b', '\\behr\\b', 'clinical', 'physician', 'pharmacy'],
            context: ['medical', 'diagnosis', 'treatment', 'healthcare provider']
        },
        // Pure clerical/administrative roles. SIGNAL terms are specific phrases so
        // this never fires on an executive/ops résumé that merely "administered" or
        // "managed" things, nor on a "Sales Assistant" (→ sales domain).
        admin_clerical: {
            signal: ['administrative assistant', 'office assistant', 'executive assistant', 'personal assistant',
                'data entry', 'receptionist', 'front desk', 'clerical', 'mailroom', 'file clerk', 'office clerk'],
            context: ['answering phones', 'filing', 'photocopying']
        },
    };

    const RESUME_SATURATION = 5;   // weighted-term score at which résumé affinity → 1.0 (~2–3 signal terms)
    const SCAN_LIMIT = 12000;      // chars scanned per document (perf)

    function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    // Build one global regex per (domain, tier). Terms already containing regex
    // syntax (e.g. "\\bpython\\b", "c\\+\\+") are used verbatim; plain phrases are
    // escaped and given word boundaries where they start/end on an alnum char.
    function compileTier(terms) {
        const parts = terms.map(t => {
            if (t.includes('\\b') || t.includes('\\+') || t.includes('\\.') || t.includes('\\')) return t;
            const esc = escapeRegExp(t);
            const sb = /^[a-z0-9]/i.test(t) ? '\\b' : '';
            const eb = /[a-z0-9]$/i.test(t) ? '\\b' : '';
            return `${sb}${esc}${eb}`;
        });
        return new RegExp(parts.join('|'), 'ig');
    }

    const COMPILED = {};
    for (const [dom, { signal, context }] of Object.entries(DOMAINS)) {
        COMPILED[dom] = { signal: compileTier(signal), context: compileTier(context) };
    }

    // Distinct-match count for a compiled global regex (case-insensitive dedup).
    function distinctCount(re, text) {
        re.lastIndex = 0;
        const m = text.match(re);
        if (!m) return 0;
        return new Set(m.map(s => s.toLowerCase())).size;
    }

    const competencyProfiler = {
        DOMAINS,

        // Raw weighted score per domain for a text (signal ×2 + context ×1, distinct terms).
        _rawWeights(text) {
            const t = (text || '').toString().slice(0, SCAN_LIMIT).toLowerCase();
            const w = {};
            let total = 0;
            for (const dom of Object.keys(DOMAINS)) {
                const s = distinctCount(COMPILED[dom].signal, t);
                const c = distinctCount(COMPILED[dom].context, t);
                const score = s * 2 + c;
                w[dom] = score;
                total += score;
            }
            return { weights: w, total };
        },

        // Résumé → per-domain AFFINITY in [0,1] (saturating). This is the
        // candidate's "competency shape": which domains they genuinely belong to.
        profileResume(text) {
            const { weights, total } = this._rawWeights(text);
            const affinity = {};
            for (const dom of Object.keys(DOMAINS)) {
                affinity[dom] = Math.min(1, weights[dom] / RESUME_SATURATION);
            }
            return { affinity, hasSignal: total > 0 };
        },

        // Job → normalized domain distribution (sums to 1) + dominant domain.
        profileJob(job) {
            const text = `${job.title || ''} ${job.title || ''} ${job.description_full || job.description || ''}`;
            const { weights, total } = this._rawWeights(text);
            const dist = {};
            let dom = null, best = 0;
            for (const d of Object.keys(DOMAINS)) {
                dist[d] = total > 0 ? weights[d] / total : 0;
                if (weights[d] > best) { best = weights[d]; dom = d; }
            }
            return { dist, dominant: dom, hasSignal: total > 0 };
        },

        // Compatibility multiplier in (0,1] applied to a job's Delta-X.
        //   • No résumé signal OR no job signal → 1.0 (don't guess; let overlap stand).
        //   • compat = Σ_d jobDist[d] · résuméAffinity[d]  (how much of the job's
        //     domain mass falls in domains the candidate actually has standing in).
        //   • Extra gate: if the job's PRIMARY domain is one the candidate barely
        //     touches (affinity < 0.2), hard-cap the multiplier so a coincidental
        //     keyword overlap in a foreign field can't masquerade as a real match.
        // Always returns { mult (0.08–1], compat (0–1|null), primary (domain|null) }.
        compatMultiplier(resumeAffinity, job) {
            const skip = { mult: 1, compat: null, primary: null };
            if (!resumeAffinity) return skip;
            if (!Object.values(resumeAffinity).some(v => v > 0)) return skip; // sparse/no résumé → don't gate (avoid blanking)

            const jp = this.profileJob(job);
            if (!jp.hasSignal) return skip; // generic/short JD → no reliable domain signal

            let compat = 0;
            for (const d of Object.keys(DOMAINS)) compat += jp.dist[d] * (resumeAffinity[d] || 0);
            compat = Math.max(0, Math.min(1, compat));

            let mult = 0.12 + 0.88 * compat;
            const domAff = resumeAffinity[jp.dominant] || 0;
            if (domAff < 0.2) mult = Math.min(mult, 0.25); // primary domain is foreign → crush
            return { mult: Math.max(0.08, Math.min(1, mult)), compat, primary: jp.dominant };
        }
    };

    window.competencyProfiler = competencyProfiler; // Export globally
})();
