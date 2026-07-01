(function () {
    'use strict';

    function computeFriction(job, profile) {
        // Gap is measured against the dual-baseline effective anchor (the axis that
        // actually decides the zone), so within-zone tiering agrees with routing.
        const seniorityGap = Math.abs(job.trajectory_effective ?? job.trajectory_recent ?? 0);
        const skillGap = 1 - (job.overlap_ratio || 0);
        // We will default to 0.5 if industry is missing, or exactly matches
        // primaryIndustry would come from profile.categories[0] usually
        const primaryIndustry = (profile.categories && profile.categories.length > 0) ? profile.categories[0] : null;
        const industryDistance = (job.industry === primaryIndustry || !primaryIndustry) ? 0 : 0.5;
        
        return 0.4 * (seniorityGap / 4) + 0.4 * skillGap + 0.2 * industryDistance;
    }

    window.transitionFriction = { compute: computeFriction };
})();
