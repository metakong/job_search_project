import unittest
from evaluator import evaluate_eligibility
from cleaner import scrub_boilerplate
from core.resolver import CompanyResolver
from core.culture_evaluator import CorporateCultureEvaluator
from core.skill_matcher import SkillMatcher

class MockPocketbaseClient:
    def __init__(self):
        self.inserted_companies = []
        
    async def insert_company(self, name: str, hq_location: str = None) -> str:
        new_id = f"company_id_{len(self.inserted_companies)}"
        self.inserted_companies.append({"id": new_id, "name": name})
        return new_id

class TestPhase2(unittest.TestCase):

    def test_evaluate_eligibility_eligible(self):
        description = "We are seeking a Senior Operations Manager with 7+ years of experience. Standard hours, competitive base salary."
        is_eligible, reason = evaluate_eligibility(description)
        self.assertTrue(is_eligible)
        self.assertIsNone(reason)

    def test_evaluate_eligibility_junior_disqualified(self):
        description = "This is a Junior Developer role assisting the lead architect."
        is_eligible, reason = evaluate_eligibility(description)
        self.assertFalse(is_eligible)
        self.assertEqual(reason, "Entry-Level/Support")

    def test_evaluate_eligibility_mlm_disqualified(self):
        description = "Make $2000 a week! 100% commission sales rep. No experience necessary, immediate hire!"
        is_eligible, reason = evaluate_eligibility(description)
        self.assertFalse(is_eligible)
        self.assertEqual(reason, "MLM/Predatory")

    def test_evaluate_eligibility_rn_disqualified(self):
        description = "Looking for a registered nurse (RN) to join our clinical team."
        is_eligible, reason = evaluate_eligibility(description)
        self.assertFalse(is_eligible)
        self.assertEqual(reason, "Regulated/Non-Relevant")

    def test_evaluate_eligibility_dotnet_disqualified(self):
        description = "Requires extensive experience building services on .NET Framework."
        is_eligible, reason = evaluate_eligibility(description)
        self.assertFalse(is_eligible)
        self.assertEqual(reason, "Regulated/Non-Relevant")

    def test_scrub_boilerplate_eeo_truncation(self):
        text = "This is a description of the operations systems manager role. We need a CRM expert. Equal Opportunity Employer: Applicants will receive consideration regardless of race, color, religion, sex."
        cleaned = scrub_boilerplate(text)
        self.assertIn("CRM expert", cleaned)
        self.assertNotIn("Equal Opportunity", cleaned)
        self.assertNotIn("Applicants will receive consideration", cleaned)

    def test_scrub_boilerplate_benefits_truncation(self):
        text = "Operational signal text here. We offer a comprehensive benefits package including health, dental, vision, and 401(k)."
        cleaned = scrub_boilerplate(text)
        self.assertIn("Operational signal text here", cleaned)
        self.assertNotIn("comprehensive benefits", cleaned)
        self.assertNotIn("health, dental, vision", cleaned)

    def test_scrub_boilerplate_html_whitespace(self):
        text = "   <p>Operational   signal</p>   \n   text. "
        cleaned = scrub_boilerplate(text)
        self.assertEqual(cleaned, "Operational signal text.")

    def test_scrub_boilerplate_no_accidental_pto_truncation(self):
        text = "We will investigate every symptom of inefficiency in our operations."
        cleaned = scrub_boilerplate(text)
        self.assertIn("symptom of inefficiency", cleaned)

    def test_scrub_boilerplate_disabilities_truncation(self):
        text = "Operational info. We do not discriminate on the basis of disabilities."
        cleaned = scrub_boilerplate(text)
        self.assertIn("Operational info.", cleaned)
        self.assertNotIn("disabilities", cleaned)

    def test_scrub_boilerplate_health_dental_vision_variations(self):
        variations = [
            "Operational info. We offer health, dental, vision plans.",
            "Operational info. We offer health, dental and vision plans.",
            "Operational info. We offer health, dental & vision plans."
        ]
        for var in variations:
            cleaned = scrub_boilerplate(var)
            self.assertEqual(cleaned, "Operational info. We offer")

class TestResolver(unittest.IsolatedAsyncioTestCase):
    
    async def test_resolve_exact_match(self):
        client = MockPocketbaseClient()
        resolver = CompanyResolver(client)
        resolver.company_master_dict = {"settler structures": "comp_1"}
        
        resolved_id = await resolver.resolve_company_identity("Settler Structures")
        self.assertEqual(resolved_id, "comp_1")
        self.assertEqual(len(client.inserted_companies), 0)

    async def test_resolve_fuzzy_match_above_threshold(self):
        client = MockPocketbaseClient()
        resolver = CompanyResolver(client)
        resolver.company_master_dict = {"oreilly automotive": "comp_2"}
        
        # "O'Reilly Auto" vs "oreilly automotive" has a token_sort_ratio > 66%
        resolved_id = await resolver.resolve_company_identity("O'Reilly Auto")
        self.assertEqual(resolved_id, "comp_2")
        self.assertEqual(len(client.inserted_companies), 0)
        self.assertIn("oreilly auto", resolver.company_master_dict)

    async def test_resolve_fuzzy_match_below_threshold(self):
        client = MockPocketbaseClient()
        resolver = CompanyResolver(client)
        resolver.company_master_dict = {"settler structures": "comp_1"}
        
        # "MemeCorp" vs "settler structures" has score < 66%
        resolved_id = await resolver.resolve_company_identity("MemeCorp")
        self.assertEqual(resolved_id, "company_id_0")
        self.assertEqual(len(client.inserted_companies), 1)
        self.assertEqual(client.inserted_companies[0]["name"], "MemeCorp")
        self.assertEqual(resolver.company_master_dict["memecorp"], "company_id_0")

class TestCultureAndSkillMatcher(unittest.TestCase):
    def setUp(self):
        self.evaluator = CorporateCultureEvaluator()
        self.matcher = SkillMatcher()

    def test_culture_evaluator_empty(self):
        self.assertEqual(self.evaluator.evaluate(""), 0)
        self.assertEqual(self.evaluator.evaluate(None), 0)

    def test_culture_evaluator_no_flags(self):
        text = "This is a very nice workplace with good work life balance and great projects."
        self.assertEqual(self.evaluator.evaluate(text), 0)

    def test_culture_evaluator_distinct_flags(self):
        # Matches: "fast-paced environment", "rockstar", "we're a family"
        text = "We are a rockstar team in a fast-paced environment. We're a family here!"
        self.assertEqual(self.evaluator.evaluate(text), 3)

    def test_culture_evaluator_case_insensitive_and_boundaries(self):
        # Case insensitive
        self.assertEqual(self.evaluator.evaluate("NINJA wanted"), 1)
        # Word boundary: "ninja" shouldn't match "ninjas"
        self.assertEqual(self.evaluator.evaluate("We need ninjas"), 0)

    def test_skill_matcher_empty(self):
        self.assertEqual(self.matcher.match(""), 0)
        self.assertEqual(self.matcher.match(None), 0)

    def test_skill_matcher_matches(self):
        text = "Must have experience with Salesforce, Zapier, and RevOps."
        # Matches Salesforce, Zapier, RevOps (Total 3)
        self.assertEqual(self.matcher.match(text), 3)

    def test_skill_matcher_boundaries(self):
        # SQL should match but MySQL should not
        self.assertEqual(self.matcher.match("We use SQL here"), 1)
        self.assertEqual(self.matcher.match("We use MySQL here"), 0)
        self.assertEqual(self.matcher.match("We use NoSQL here"), 0)

    def test_target_status_logic(self):
        # Test Case 1: skill_match_count >= 3 AND toxicity_score >= 2 -> "Turnaround / High Leverage"
        # Test Case 2: skill_match_count >= 3 AND toxicity_score == 0 -> "Pristine Target"
        # Test Case 3: skill_match_count < 3 AND toxicity_score >= 2 -> "Toxic / Low Match (Discard)"
        # Test Case 4: Else -> "Standard Review"
        
        def get_status(skills, toxicity):
            if skills >= 3 and toxicity >= 2:
                return "Turnaround / High Leverage"
            elif skills >= 3 and toxicity == 0:
                return "Pristine Target"
            elif skills < 3 and toxicity >= 2:
                return "Toxic / Low Match (Discard)"
            else:
                return "Standard Review"

        self.assertEqual(get_status(3, 2), "Turnaround / High Leverage")
        self.assertEqual(get_status(4, 5), "Turnaround / High Leverage")
        self.assertEqual(get_status(3, 0), "Pristine Target")
        self.assertEqual(get_status(5, 0), "Pristine Target")
        self.assertEqual(get_status(2, 2), "Toxic / Low Match (Discard)")
        self.assertEqual(get_status(1, 3), "Toxic / Low Match (Discard)")
        self.assertEqual(get_status(2, 0), "Standard Review")
        self.assertEqual(get_status(3, 1), "Standard Review")

if __name__ == "__main__":
    unittest.main()
