import logging
import json
from pathlib import Path

# Set up logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s"
)
logger = logging.getLogger("cleansing_logger")

class CleansingLogger:
    """
    Logs and keeps track of jobs that are kept vs dropped.
    Saves execution statistics to a JSON file.
    """
    
    def __init__(self, stats_path: str = "cleansing_stats.json"):
        self.stats_path = Path(stats_path)
        self.total_processed = 0
        self.total_kept = 0
        self.total_dropped = 0
        self.drop_reasons = {}
        # ── Extended counters (added in Phase 8 refactor — never removed) ──
        self.stale_flagged          = 0   # records where is_stale=True
        self.ghost_jobs_flagged     = 0   # records where is_ghost_job=True
        self.duplicates_flagged     = 0   # records where is_duplicate=True (RapidFuzz)
        self.salary_floor_discards  = 0   # discard_reason=Below-Salary-Floor
        self.remote_no_local        = 0   # discard_reason=Remote-No-Local-Presence
        self.blacklist_discards     = 0   # discard_reason=Blacklisted-Company

    def log_job(self, title: str, company: str, is_eligible: bool, discard_reason: str = None):
        """
        Logs job processing status and updates counts.
        """
        self.total_processed += 1
        if is_eligible:
            self.total_kept += 1
            logger.info(f"KEEP: '{title}' at '{company}'")
        else:
            self.total_dropped += 1
            self.drop_reasons[discard_reason] = self.drop_reasons.get(discard_reason, 0) + 1
            logger.info(f"DROP: '{title}' at '{company}' | Reason: {discard_reason}")

    def save_stats(self):
        """
        Writes aggregated stats to JSON file.
        Original keys are always present first (backward compatibility guarantee).
        Extended keys follow — never remove or reorder the original four.
        """
        stats = {
            # ── Original keys (never modified, never removed) ────────────
            "total_processed": self.total_processed,
            "total_kept":      self.total_kept,
            "total_dropped":   self.total_dropped,
            "drop_reasons":    self.drop_reasons,
            # ── Extended keys (Phase 8 additions) ───────────────────────
            "stale_flagged":         self.stale_flagged,
            "ghost_jobs_flagged":    self.ghost_jobs_flagged,
            "duplicates_flagged":    self.duplicates_flagged,
            "salary_floor_discards": self.salary_floor_discards,
            "remote_no_local_discards": self.remote_no_local,
            "blacklist_discards":    self.blacklist_discards,
        }
        try:
            self.stats_path.write_text(json.dumps(stats, indent=2), encoding="utf-8")
            logger.info(f"Cleansing stats saved to {self.stats_path}")
        except Exception as e:
            logger.error(f"Failed to save cleansing stats to {self.stats_path}: {e}")

    def print_summary(self):
        """
        Prints a clean summary output to console.
        """
        print("\n" + "="*50)
        print("         CLEANSING PIPELINE RUN SUMMARY")
        print("="*50)
        print(f"Total Jobs Processed: {self.total_processed}")
        print(f"Total Jobs Kept:      {self.total_kept}")
        print(f"Total Jobs Dropped:   {self.total_dropped}")
        if self.drop_reasons:
            print("\nDrop Breakdown by Category:")
            for reason, count in self.drop_reasons.items():
                print(f" - {reason}: {count}")
        print("="*50 + "\n")
