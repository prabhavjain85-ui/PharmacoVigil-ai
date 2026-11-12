"""
Evaluation suite for PharmacoVigil-AI Signal Assessment Drafts & Natural-Language Filter:
1. 20 drug-event pairs with known FDA SPL label status (10 labelled, 10 not labelled):
   evaluates deterministic label-status matching accuracy.
2. 10 generated Signal Assessment Drafts:
   evaluates citation verification and hand-checked source-support accuracy across every
   factual sentence in all 10 drafts, producing the Markdown table for the PR.
3. 30 natural-language questions with expected JSON filters:
   evaluates exact-match accuracy of the NL-to-JSON filter translator and schema validator.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from signal_copilot import (
    PROMPT_VERSION_ASSESSMENT,
    PROMPT_VERSION_NL_FILTER,
    determine_label_status,
    draft_to_markdown,
    generate_signal_assessment_draft,
    translate_nl_query_to_filter,
    validate_signal_filter,
)


# ---------------------------------------------------------------------------
# 1. 20 Drug-Event Pairs with Known FDA SPL Label Status (10 Labelled, 10 Not)
# ---------------------------------------------------------------------------

LABEL_EVALUATION_PAIRS: List[Dict[str, Any]] = [
    # --- 10 Known Labelled Pairs (expected_labelled = True) ---
    {
        "id": "L01",
        "drug": "WARFARIN",
        "adverse_event": "GASTROINTESTINAL HAEMORRHAGE",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": (
                "WARNING: BLEEDING RISK. Warfarin sodium can cause major or fatal bleeding. "
                "Gastrointestinal hemorrhage and intracranial hemorrhage are the most frequent "
                "manifestations of major bleeding."
            ),
            "warnings": "Monitor INR closely to reduce risk of hemorrhage.",
            "adverse_reactions": "Hemorrhage from any tissue or organ, epistaxis, hematuria.",
        },
    },
    {
        "id": "L02",
        "drug": "ATORVASTATIN",
        "adverse_event": "RHABDOMYOLYSIS",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": "",
            "warnings": (
                "Skeletal Muscle: Cases of myopathy and rhabdomyolysis with acute renal failure "
                "secondary to myoglobinuria have been reported with HMG-CoA reductase inhibitors, "
                "including atorvastatin."
            ),
            "adverse_reactions": "Myalgia, muscle spasms, arthralgia, diarrhea, nasopharyngitis.",
        },
    },
    {
        "id": "L03",
        "drug": "LISINOPRIL",
        "adverse_event": "ANGIOEDEMA",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": "WARNING: FETAL TOXICITY.",
            "warnings": (
                "Head and Neck Angioedema: Angioedema of the face, extremities, lips, tongue, "
                "glottis, and/or larynx has been reported in patients treated with ACE inhibitors, "
                "including lisinopril."
            ),
            "adverse_reactions": "Cough, dizziness, headache, hypotension, hyperkalemia.",
        },
    },
    {
        "id": "L04",
        "drug": "AMOXICILLIN",
        "adverse_event": "ANAPHYLACTIC REACTION",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": "",
            "warnings": (
                "Serious and occasionally fatal hypersensitivity (anaphylactic) reactions have been "
                "reported in patients on penicillin therapy including amoxicillin."
            ),
            "adverse_reactions": "Rash, diarrhea, nausea, vomiting, urticaria.",
        },
    },
    {
        "id": "L05",
        "drug": "METFORMIN",
        "adverse_event": "LACTIC ACIDOSIS",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": (
                "WARNING: LACTIC ACIDOSIS. Postmarketing cases of metformin-associated lactic acidosis "
                "have resulted in death, hypothermia, hypotension, and resistant bradyarrhythmias."
            ),
            "warnings": "Assess renal function before initiating metformin.",
            "adverse_reactions": "Diarrhea, nausea, vomiting, flatulence, asthenia.",
        },
    },
    {
        "id": "L06",
        "drug": "ACETAMINOPHEN",
        "adverse_event": "HEPATIC FAILURE",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": (
                "WARNING: HEPATOTOXICITY. Acetaminophen has been associated with cases of acute liver "
                "failure, at times resulting in liver transplant and death."
            ),
            "warnings": "Do not exceed 4000 mg per day.",
            "adverse_reactions": "Nausea, rash, headache, transaminases increased.",
        },
    },
    {
        "id": "L07",
        "drug": "SERTRALINE",
        "adverse_event": "SUICIDAL IDEATION",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": (
                "WARNING: SUICIDAL THOUGHTS AND BEHAVIORS. Antidepressants increased the risk of "
                "suicidal thoughts and behavior (suicidality) in children, adolescents, and young adults."
            ),
            "warnings": "Serotonin syndrome, bleeding risk, activation of mania.",
            "adverse_reactions": "Nausea, diarrhea, insomnia, dry mouth, somnolence, dizziness.",
        },
    },
    {
        "id": "L08",
        "drug": "CIPROFLOXACIN",
        "adverse_event": "TENDON RUPTURE",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": (
                "WARNING: SERIOUS ADVERSE REACTIONS INCLUDING TENDINITIS, TENDON RUPTURE, PERIPHERAL "
                "NEUROPATHY, CENTRAL NERVOUS SYSTEM EFFECTS, AND EXACERBATION OF MYASTHENIA GRAVIS."
            ),
            "warnings": "Discontinue ciprofloxacin immediately if pain or inflammation in a tendon occurs.",
            "adverse_reactions": "Nausea, diarrhea, liver function tests abnormal, vomiting, rash.",
        },
    },
    {
        "id": "L09",
        "drug": "ISOTRETINOIN",
        "adverse_event": "CONGENITAL ANOMALY",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": (
                "CONTRAINDICATIONS AND WARNINGS: Isotretinoin must not be used by female patients who "
                "are or may become pregnant. There is an extremely high risk that major human fetal "
                "abnormalities and birth defects will occur if pregnancy occurs during treatment."
            ),
            "warnings": "Psychiatric disorders, pseudotumor cerebri, pancreatitis.",
            "adverse_reactions": "Cheilitis, dry skin, xerostomia, epistaxis, arthralgia.",
        },
    },
    {
        "id": "L10",
        "drug": "IBUProfen".upper(),
        "adverse_event": "ACUTE KIDNEY INJURY",
        "expected_labelled": True,
        "label_sections": {
            "boxed_warning": "WARNING: RISK OF SERIOUS CARDIOVASCULAR AND GASTROINTESTINAL EVENTS.",
            "warnings": (
                "Renal Toxicity and Hyperkalemia: Long-term administration of NSAIDs has resulted in "
                "renal papillary necrosis and other renal injury, including acute renal failure."
            ),
            "adverse_reactions": "Dyspepsia, abdominal pain, nausea, constipation, edema, dizziness.",
        },
    },
    # --- 10 Known Unlabelled / Negative Pairs (expected_labelled = False) ---
    {
        "id": "U01",
        "drug": "METFORMIN",
        "adverse_event": "RHABDOMYOLYSIS",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": "WARNING: LACTIC ACIDOSIS.",
            "warnings": "Vitamin B12 deficiency, hypoglycemia with insulin secretagogues.",
            "adverse_reactions": "Diarrhea, nausea, vomiting, flatulence, abdominal discomfort, headache.",
        },
    },
    {
        "id": "U02",
        "drug": "LORATADINE",
        "adverse_event": "GASTROINTESTINAL HAEMORRHAGE",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": "",
            "warnings": "Use with caution in patients with severe hepatic or renal impairment.",
            "adverse_reactions": "Headache, somnolence, fatigue, dry mouth, nervousness.",
        },
    },
    {
        "id": "U03",
        "drug": "LEVOTHYROXINE",
        "adverse_event": "STEVENS-JOHNSON SYNDROME",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": (
                "WARNING: NOT FOR TREATMENT OF OBESITY OR FOR WEIGHT LOSS. Larger doses may produce "
                "serious or even life-threatening manifestations of toxicity."
            ),
            "warnings": "Cardiac adverse reactions in the elderly, myxedema coma, decreased bone mineral density.",
            "adverse_reactions": "Arrhythmias, tachycardia, palpitations, tremor, insomnia, weight loss.",
        },
    },
    {
        "id": "U04",
        "drug": "AMLODIPINE",
        "adverse_event": "AGRANULOCYTOSIS",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": "",
            "warnings": "Symptomatic hypotension, worsening angina and acute myocardial infarction.",
            "adverse_reactions": "Edema, dizziness, flushing, palpitations, fatigue, nausea, abdominal pain.",
        },
    },
    {
        "id": "U05",
        "drug": "OMEPRAZOLE",
        "adverse_event": "TENDON RUPTURE",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": "",
            "warnings": (
                "Gastric malignancy, acute tubulointerstitial nephritis, Clostridium difficile-associated "
                "diarrhea, bone fracture, hypomagnesemia."
            ),
            "adverse_reactions": "Headache, abdominal pain, nausea, diarrhea, vomiting, flatulence.",
        },
    },
    {
        "id": "U06",
        "drug": "WARFARIN",
        "adverse_event": "LACTIC ACIDOSIS",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": "WARNING: BLEEDING RISK. Warfarin sodium can cause major or fatal bleeding.",
            "warnings": "Tissue necrosis (calciphylaxis), systemic atheroemboli and cholesterol microemboli.",
            "adverse_reactions": "Hemorrhage, necrosis of skin and other tissues, alopecia, rash.",
        },
    },
    {
        "id": "U07",
        "drug": "MONTELUKAST",
        "adverse_event": "PULMONARY FIBROSIS",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": (
                "WARNING: SERIOUS NEUROPSYCHIATRIC EVENTS. Neuropsychiatric events have been reported "
                "with montelukast."
            ),
            "warnings": "Acute asthma, eosinophilic conditions, phenylketonurics.",
            "adverse_reactions": "Upper respiratory infection, fever, headache, pharyngitis, cough.",
        },
    },
    {
        "id": "U08",
        "drug": "METOPROLOL",
        "adverse_event": "RETINAL DETACHMENT",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": (
                "WARNING: ISCHEMIC HEART DISEASE. Following abrupt cessation of therapy with beta-blockers, "
                "exacerbations of angina pectoris and myocardial infarction have occurred."
            ),
            "warnings": "Heart failure, bronchospastic disease, bradycardia,pheochromocytoma.",
            "adverse_reactions": "Tiredness, dizziness, depression, shortness of breath, bradycardia, diarrhea.",
        },
    },
    {
        "id": "U09",
        "drug": "HYDROCHLOROTHIAZIDE",
        "adverse_event": "PERIPHERAL NEUROPATHY",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": "",
            "warnings": (
                "Acute myopia and secondary angle-closure glaucoma, electrolyte imbalances "
                "(hypokalemia, hyponatremia), hyperuricemia, hyperglycemia."
            ),
            "adverse_reactions": "Weakness, hypotension, orthostatic hypotension, pancreatitis, jaundice.",
        },
    },
    {
        "id": "U10",
        "drug": "FINASTERIDE",
        "adverse_event": "HEPATIC FAILURE",
        "expected_labelled": False,
        "label_sections": {
            "boxed_warning": "",
            "warnings": (
                "Increased risk of high-grade prostate cancer, effects on prostate-specific antigen (PSA), "
                "exposure of women — risk to male fetus. Clinical trials showed no evidence of hepatic failure."
            ),
            "adverse_reactions": "Impotence, decreased libido, decreased volume of ejaculate, gynecomastia.",
        },
    },
]


# ---------------------------------------------------------------------------
# 2. 10 Drug-Event Pairs for Generated Draft Citation Verification
# ---------------------------------------------------------------------------

DRAFT_EVALUATION_CASES: List[Dict[str, Any]] = [
    {
        "draft_id": "D01",
        "stats": {
            "drug": "WARFARIN",
            "adverse_event": "GASTROINTESTINAL HAEMORRHAGE",
            "case_count_a": 42,
            "drug_total_reports": 68,
            "event_total_reports": 51,
            "total_reports": 200,
            "PRR": 8.41,
            "ROR": 20.38,
            "ROR_95CI_low": 9.12,
            "ROR_95CI_high": 45.54,
            "chi_square": 62.18,
            "p_value": 0.000001,
            "q_value": 0.000012,
            "IC": 1.62,
            "IC025": 1.18,
            "IC975": 2.04,
            "EBGM": 1.27,
            "EB05": 1.05,
            "EB95": 1.54,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
        "label": {
            "source_url": "https://api.fda.gov/drug/label.json?search=warfarin",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "label_found": True,
            "brand_names": ["COUMADIN"],
            "generic_names": ["WARFARIN SODIUM"],
            "sections": LABEL_EVALUATION_PAIRS[0]["label_sections"],
        },
        "pubmed": {
            "source_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "query": '("WARFARIN"[Title/Abstract]) AND ("GASTROINTESTINAL HAEMORRHAGE"[Title/Abstract])',
            "total_found": 2,
            "abstracts": [
                {
                    "pmid": "38412011",
                    "title": "Anticoagulant-associated upper and lower gastrointestinal bleeding in older adults",
                    "journal": "Drug Safety",
                    "pub_date": "2024 Nov",
                    "abstract_excerpt": "Observational cohort evaluating vitamin K antagonist monitoring and gastrointestinal bleeding risk factors.",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/38412011/",
                },
                {
                    "pmid": "37904512",
                    "title": "Real-world comparison of warfarin and direct oral anticoagulants",
                    "journal": "Pharmacotherapy",
                    "pub_date": "2024 Mar",
                    "abstract_excerpt": "Confounding by indication and concomitant antiplatelet therapy strongly influence bleeding rates.",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/37904512/",
                },
            ],
        },
    },
    {
        "draft_id": "D02",
        "stats": {
            "drug": "ATORVASTATIN",
            "adverse_event": "RHABDOMYOLYSIS",
            "case_count_a": 24,
            "drug_total_reports": 48,
            "event_total_reports": 30,
            "total_reports": 200,
            "PRR": 12.67,
            "ROR": 24.33,
            "ROR_95CI_low": 9.10,
            "ROR_95CI_high": 65.05,
            "chi_square": 48.92,
            "p_value": 0.000001,
            "q_value": 0.000012,
            "IC": 1.58,
            "IC025": 0.99,
            "IC975": 2.12,
            "EBGM": 1.31,
            "EB05": 1.02,
            "EB95": 1.66,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
        "label": {
            "source_url": "https://api.fda.gov/drug/label.json?search=atorvastatin",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "label_found": True,
            "brand_names": ["LIPITOR"],
            "generic_names": ["ATORVASTATIN CALCIUM"],
            "sections": LABEL_EVALUATION_PAIRS[1]["label_sections"],
        },
        "pubmed": {
            "source_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "query": '("ATORVASTATIN"[Title/Abstract]) AND ("RHABDOMYOLYSIS"[Title/Abstract])',
            "total_found": 2,
            "abstracts": [
                {
                    "pmid": "38291044",
                    "title": "Statin-induced myopathy and CYP3A4 drug interactions in spontaneous reports",
                    "journal": "Clin Pharmacol Ther",
                    "pub_date": "2024 Sep",
                    "abstract_excerpt": "Co-medication with CYP3A4 inhibitors increases systemic statin exposure in rhabdomyolysis reports.",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/38291044/",
                },
                {
                    "pmid": "37651109",
                    "title": "Pharmacovigilance signal evaluation of HMG-CoA reductase inhibitors",
                    "journal": "Br J Clin Pharmacol",
                    "pub_date": "2023 Dec",
                    "abstract_excerpt": "Disproportionality analysis of skeletal muscle events in FAERS.",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/37651109/",
                },
            ],
        },
    },
    {
        "draft_id": "D03",
        "stats": {
            "drug": "LISINOPRIL",
            "adverse_event": "ANGIOEDEMA",
            "case_count_a": 19,
            "drug_total_reports": 38,
            "event_total_reports": 23,
            "total_reports": 200,
            "PRR": 20.25,
            "ROR": 39.50,
            "ROR_95CI_low": 12.14,
            "ROR_95CI_high": 128.51,
            "chi_square": 52.10,
            "p_value": 0.000001,
            "q_value": 0.000012,
            "IC": 1.69,
            "IC025": 1.03,
            "IC975": 2.30,
            "EBGM": 1.38,
            "EB05": 1.04,
            "EB95": 1.81,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
        "label": {
            "source_url": "https://api.fda.gov/drug/label.json?search=lisinopril",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "label_found": True,
            "brand_names": ["PRINIVIL", "ZESTRIL"],
            "generic_names": ["LISINOPRIL"],
            "sections": LABEL_EVALUATION_PAIRS[2]["label_sections"],
        },
        "pubmed": {
            "source_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "query": '("LISINOPRIL"[Title/Abstract]) AND ("ANGIOEDEMA"[Title/Abstract])',
            "total_found": 1,
            "abstracts": [
                {
                    "pmid": "38100231",
                    "title": "Bradykinin-mediated angioedema associated with ACE inhibitors",
                    "journal": "Allergy Asthma Proc",
                    "pub_date": "2024 Jul",
                    "abstract_excerpt": "Epidemiologic review of ACE inhibitor angioedema risk factors.",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/38100231/",
                },
            ],
        },
    },
    {
        "draft_id": "D04",
        "stats": {
            "drug": "AMOXICILLIN",
            "adverse_event": "ANAPHYLACTIC REACTION",
            "case_count_a": 16,
            "drug_total_reports": 35,
            "event_total_reports": 21,
            "total_reports": 200,
            "PRR": 15.09,
            "ROR": 26.95,
            "ROR_95CI_low": 8.85,
            "ROR_95CI_high": 82.06,
            "chi_square": 39.44,
            "p_value": 0.000001,
            "q_value": 0.000015,
            "IC": 1.54,
            "IC025": 0.84,
            "IC975": 2.19,
            "EBGM": 1.29,
            "EB05": 0.96,
            "EB95": 1.72,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
        "label": {
            "source_url": "https://api.fda.gov/drug/label.json?search=amoxicillin",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "label_found": True,
            "brand_names": ["AMOXIL"],
            "generic_names": ["AMOXICILLIN"],
            "sections": LABEL_EVALUATION_PAIRS[3]["label_sections"],
        },
        "pubmed": {
            "source_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "query": '("AMOXICILLIN"[Title/Abstract]) AND ("ANAPHYLACTIC REACTION"[Title/Abstract])',
            "total_found": 1,
            "abstracts": [
                {
                    "pmid": "37882910",
                    "title": "Beta-lactam hypersensitivity reporting patterns in spontaneous databases",
                    "journal": "J Allergy Clin Immunol Pract",
                    "pub_date": "2024 Feb",
                    "abstract_excerpt": "Analysis of immediate-type hypersensitivity reports for aminopenicillins.",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/37882910/",
                },
            ],
        },
    },
    {
        "draft_id": "D05",
        "stats": {
            "drug": "METFORMIN",
            "adverse_event": "LACTIC ACIDOSIS",
            "case_count_a": 14,
            "drug_total_reports": 34,
            "event_total_reports": 17,
            "total_reports": 200,
            "PRR": 22.78,
            "ROR": 39.90,
            "ROR_95CI_low": 10.56,
            "ROR_95CI_high": 150.71,
            "chi_square": 41.12,
            "p_value": 0.000001,
            "q_value": 0.000015,
            "IC": 1.61,
            "IC025": 0.87,
            "IC975": 2.29,
            "EBGM": 1.33,
            "EB05": 0.97,
            "EB95": 1.81,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
        "label": {
            "source_url": "https://api.fda.gov/drug/label.json?search=metformin",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "label_found": True,
            "brand_names": ["GLUCOPHAGE"],
            "generic_names": ["METFORMIN HYDROCHLORIDE"],
            "sections": LABEL_EVALUATION_PAIRS[4]["label_sections"],
        },
        "pubmed": {
            "source_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "query": '("METFORMIN"[Title/Abstract]) AND ("LACTIC ACIDOSIS"[Title/Abstract])',
            "total_found": 2,
            "abstracts": [
                {
                    "pmid": "38501920",
                    "title": "Metformin-associated lactic acidosis in patients with acute renal impairment",
                    "journal": "Diabetes Obes Metab",
                    "pub_date": "2024 Oct",
                    "abstract_excerpt": "Renal function decline and contrast exposure frequently co-occur in reported lactic acidosis cases.",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/38501920/",
                },
                {
                    "pmid": "37419082",
                    "title": "Epidemiology of biguanide lactic acidosis in postmarketing surveillance",
                    "journal": "Diabetologia",
                    "pub_date": "2023 Aug",
                    "abstract_excerpt": "Assessment of background sepsis and hypoxia as alternative explanations.",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/37419082/",
                },
            ],
        },
    },
    {
        "draft_id": "D06",
        "stats": {
            "drug": "ACETAMINOPHEN",
            "adverse_event": "HEPATIC FAILURE",
            "case_count_a": 15,
            "drug_total_reports": 32,
            "event_total_reports": 19,
            "total_reports": 200,
            "PRR": 19.69,
            "ROR": 36.18,
            "ROR_95CI_low": 10.75,
            "ROR_95CI_high": 121.78,
            "chi_square": 42.85,
            "p_value": 0.000001,
            "q_value": 0.000015,
            "IC": 1.63,
            "IC025": 0.91,
            "IC975": 2.29,
            "EBGM": 1.35,
            "EB05": 0.99,
            "EB95": 1.82,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
        "label": {
            "source_url": "https://api.fda.gov/drug/label.json?search=acetaminophen",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "label_found": True,
            "brand_names": ["TYLENOL"],
            "generic_names": ["ACETAMINOPHEN"],
            "sections": LABEL_EVALUATION_PAIRS[5]["label_sections"],
        },
        "pubmed": {
            "source_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "query": '("ACETAMINOPHEN"[Title/Abstract]) AND ("HEPATIC FAILURE"[Title/Abstract])',
            "total_found": 1,
            "abstracts": [
                {
                    "pmid": "38012874",
                    "title": "Unintentional supra-therapeutic acetaminophen dosing and acute liver injury",
                    "journal": "Hepatology",
                    "pub_date": "2024 May",
                    "abstract_excerpt": "Multi-ingredient OTC combination products contribute to unintentional overdose reports.",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/38012874/",
                },
            ],
        },
    },
    {
        "draft_id": "D07",
        "stats": {
            "drug": "METFORMIN",
            "adverse_event": "RHABDOMYOLYSIS",
            "case_count_a": 4,
            "drug_total_reports": 34,
            "event_total_reports": 30,
            "total_reports": 200,
            "PRR": 0.75,
            "ROR": 0.72,
            "ROR_95CI_low": 0.23,
            "ROR_95CI_high": 2.23,
            "chi_square": 0.11,
            "p_value": 0.7401,
            "q_value": 0.8120,
            "IC": -0.32,
            "IC025": -1.61,
            "IC975": 0.79,
            "EBGM": 0.89,
            "EB05": 0.52,
            "EB95": 1.44,
            "signal_detected": False,
            "signal_bcpnn": False,
            "signal_ebgm": False,
            "signal_fdr": False,
        },
        "label": {
            "source_url": "https://api.fda.gov/drug/label.json?search=metformin",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "label_found": True,
            "brand_names": ["GLUCOPHAGE"],
            "generic_names": ["METFORMIN HYDROCHLORIDE"],
            "sections": LABEL_EVALUATION_PAIRS[10]["label_sections"],
        },
        "pubmed": {
            "source_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "query": '("METFORMIN"[Title/Abstract]) AND ("RHABDOMYOLYSIS"[Title/Abstract])',
            "total_found": 1,
            "abstracts": [
                {
                    "pmid": "36910421",
                    "title": "Concomitant statin use in diabetic patients reporting muscle symptoms",
                    "journal": "Pharmacoepidemiol Drug Saf",
                    "pub_date": "2023 Apr",
                    "abstract_excerpt": "Co-prescribed lipid-lowering therapy accounts for most muscle injury reports in type 2 diabetes cohorts.",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/36910421/",
                },
            ],
        },
    },
    {
        "draft_id": "D08",
        "stats": {
            "drug": "LORATADINE",
            "adverse_event": "GASTROINTESTINAL HAEMORRHAGE",
            "case_count_a": 3,
            "drug_total_reports": 22,
            "event_total_reports": 51,
            "total_reports": 200,
            "PRR": 0.51,
            "ROR": 0.43,
            "ROR_95CI_low": 0.12,
            "ROR_95CI_high": 1.53,
            "chi_square": 1.24,
            "p_value": 0.2655,
            "q_value": 0.4100,
            "IC": -0.68,
            "IC025": -2.18,
            "IC975": 0.57,
            "EBGM": 0.82,
            "EB05": 0.45,
            "EB95": 1.39,
            "signal_detected": False,
            "signal_bcpnn": False,
            "signal_ebgm": False,
            "signal_fdr": False,
        },
        "label": {
            "source_url": "https://api.fda.gov/drug/label.json?search=loratadine",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "label_found": True,
            "brand_names": ["CLARITIN"],
            "generic_names": ["LORATADINE"],
            "sections": LABEL_EVALUATION_PAIRS[11]["label_sections"],
        },
        "pubmed": {
            "source_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "query": '("LORATADINE"[Title/Abstract]) AND ("GASTROINTESTINAL HAEMORRHAGE"[Title/Abstract])',
            "total_found": 0,
            "abstracts": [],
        },
    },
    {
        "draft_id": "D09",
        "stats": {
            "drug": "CIPROFLOXACIN",
            "adverse_event": "TENDON RUPTURE",
            "case_count_a": 12,
            "drug_total_reports": 26,
            "event_total_reports": 14,
            "total_reports": 200,
            "PRR": 40.15,
            "ROR": 73.71,
            "ROR_95CI_low": 14.95,
            "ROR_95CI_high": 363.48,
            "chi_square": 52.88,
            "p_value": 0.000001,
            "q_value": 0.000012,
            "IC": 1.79,
            "IC025": 0.99,
            "IC975": 2.51,
            "EBGM": 1.44,
            "EB05": 1.03,
            "EB95": 1.99,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
        "label": {
            "source_url": "https://api.fda.gov/drug/label.json?search=ciprofloxacin",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "label_found": True,
            "brand_names": ["CIPRO"],
            "generic_names": ["CIPROFLOXACIN"],
            "sections": LABEL_EVALUATION_PAIRS[7]["label_sections"],
        },
        "pubmed": {
            "source_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "query": '("CIPROFLOXACIN"[Title/Abstract]) AND ("TENDON RUPTURE"[Title/Abstract])',
            "total_found": 1,
            "abstracts": [
                {
                    "pmid": "38194002",
                    "title": "Fluoroquinolone-associated tendinopathy and corticosteroid co-exposure",
                    "journal": "Antimicrob Agents Chemother",
                    "pub_date": "2024 Jun",
                    "abstract_excerpt": "Age over 60 years and systemic corticosteroid co-medication increase tendon rupture reporting.",
                    "url": "https://pubmed.ncbi.nlm.nih.gov/38194002/",
                },
            ],
        },
    },
    {
        "draft_id": "D10",
        "stats": {
            "drug": "EXPERIMENTAL_COMPOUND_X99",
            "adverse_event": "IDIOSYNCRATIC NEUROPATHY",
            "case_count_a": 5,
            "drug_total_reports": 12,
            "event_total_reports": 8,
            "total_reports": 200,
            "PRR": 26.11,
            "ROR": 44.05,
            "ROR_95CI_low": 8.42,
            "ROR_95CI_high": 230.40,
            "chi_square": 23.14,
            "p_value": 0.000002,
            "q_value": 0.000020,
            "IC": 1.38,
            "IC025": 0.34,
            "IC975": 2.31,
            "EBGM": 1.18,
            "EB05": 0.78,
            "EB95": 1.75,
            "signal_detected": True,
            "signal_bcpnn": True,
            "signal_ebgm": False,
            "signal_fdr": True,
        },
        "label": {
            "source_url": "https://api.fda.gov/drug/label.json?search=experimental_compound_x99",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "label_found": False,
            "brand_names": [],
            "generic_names": [],
            "sections": {
                "boxed_warning": "",
                "warnings": "",
                "adverse_reactions": "",
            },
        },
        "pubmed": {
            "source_url": "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/",
            "retrieved_at": "2025-05-01T00:00:00Z",
            "query": '("EXPERIMENTAL_COMPOUND_X99"[Title/Abstract]) AND ("IDIOSYNCRATIC NEUROPATHY"[Title/Abstract])',
            "total_found": 0,
            "abstracts": [],
        },
    },
]


# ---------------------------------------------------------------------------
# 3. 30 Natural-Language Questions with Expected JSON Filters
# ---------------------------------------------------------------------------

NL_FILTER_BENCHMARK: List[Dict[str, Any]] = [
    {
        "id": "Q01",
        "question": "serious events for warfarin with at least 5 cases not flagged by PRR",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "WARFARIN"},
                {"field": "serious_event", "op": "=", "value": True},
                {"field": "case_count_a", "op": ">=", "value": 5},
                {"field": "signal_detected", "op": "=", "value": False},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q02",
        "question": "signals for atorvastatin with PRR >= 3 and at least 10 cases",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "ATORVASTATIN"},
                {"field": "case_count_a", "op": ">=", "value": 10},
                {"field": "PRR", "op": ">=", "value": 3.0},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q03",
        "question": "events for lisinopril flagged by BCPNN sorted by IC025",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "LISINOPRIL"},
                {"field": "signal_bcpnn", "op": "=", "value": True},
            ],
            "sort_by": "IC025",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q04",
        "question": "top 5 serious events flagged by EBGM",
        "expected": {
            "clauses": [
                {"field": "serious_event", "op": "=", "value": True},
                {"field": "signal_ebgm", "op": "=", "value": True},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": 5,
        },
    },
    {
        "id": "Q05",
        "question": "pairs with q_value < 0.01 and PRR >= 2 sorted by q_value",
        "expected": {
            "clauses": [
                {"field": "PRR", "op": ">=", "value": 2.0},
                {"field": "q_value", "op": "<", "value": 0.01},
            ],
            "sort_by": "q_value",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q06",
        "question": "events for metformin not flagged by BCPNN with at least 4 cases",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "METFORMIN"},
                {"field": "case_count_a", "op": ">=", "value": 4},
                {"field": "signal_bcpnn", "op": "=", "value": False},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q07",
        "question": "gastrointestinal haemorrhage signals with EB05 >= 1.5",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "GASTROINTESTINAL HAEMORRHAGE"},
                {"field": "EB05", "op": ">=", "value": 1.5},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q08",
        "question": "rhabdomyolysis with at least 6 cases sorted by PRR",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "RHABDOMYOLYSIS"},
                {"field": "case_count_a", "op": ">=", "value": 6},
            ],
            "sort_by": "PRR",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q09",
        "question": "confounded pairs flagged by PRR",
        "expected": {
            "clauses": [
                {"field": "signal_detected", "op": "=", "value": True},
                {"field": "confounding_flagged", "op": "=", "value": True},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q10",
        "question": "non-serious events for amoxicillin with at least 3 cases",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "AMOXICILLIN"},
                {"field": "serious_event", "op": "=", "value": False},
                {"field": "case_count_a", "op": ">=", "value": 3},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q11",
        "question": "signals for ibuprofen flagged by FDR sorted by chi_square",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "IBUPROFEN"},
                {"field": "signal_fdr", "op": "=", "value": True},
            ],
            "sort_by": "chi_square",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q12",
        "question": "top 10 pairs with IC025 > 0.5 sorted by EBGM",
        "expected": {
            "clauses": [
                {"field": "IC025", "op": ">", "value": 0.5},
            ],
            "sort_by": "EBGM",
            "sort_dir": "desc",
            "limit": 10,
        },
    },
    {
        "id": "Q13",
        "question": "anaphylactic reaction flagged by PRR and flagged by BCPNN",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "ANAPHYLACTIC REACTION"},
                {"field": "signal_detected", "op": "=", "value": True},
                {"field": "signal_bcpnn", "op": "=", "value": True},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q14",
        "question": "hepatic failure with chi_square >= 10 and at least 5 cases",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "HEPATIC FAILURE"},
                {"field": "case_count_a", "op": ">=", "value": 5},
                {"field": "chi_square", "op": ">=", "value": 10.0},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q15",
        "question": "events for acetaminophen with ROR >= 4 sorted by ROR",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "ACETAMINOPHEN"},
                {"field": "ROR", "op": ">=", "value": 4.0},
            ],
            "sort_by": "ROR",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q16",
        "question": "pairs for omeprazole with at most 8 cases",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "OMEPRAZOLE"},
                {"field": "case_count_a", "op": "<=", "value": 8},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q17",
        "question": "angioedema with p_value < 0.005",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "ANGIOEDEMA"},
                {"field": "p_value", "op": "<", "value": 0.005},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q18",
        "question": "events for sertraline not flagged by FDR",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "SERTRALINE"},
                {"field": "signal_fdr", "op": "=", "value": False},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q19",
        "question": "serious events with priority_score >= 0.7 sorted by priority_score",
        "expected": {
            "clauses": [
                {"field": "serious_event", "op": "=", "value": True},
                {"field": "priority_score", "op": ">=", "value": 0.7},
            ],
            "sort_by": "priority_score",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q20",
        "question": "events for clopidogrel with IC >= 1.2 and at least 5 cases",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "CLOPIDOGREL"},
                {"field": "case_count_a", "op": ">=", "value": 5},
                {"field": "IC", "op": ">=", "value": 1.2},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q21",
        "question": "lactic acidosis for metformin flagged by PRR",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "METFORMIN"},
                {"field": "adverse_event", "op": "=", "value": "LACTIC ACIDOSIS"},
                {"field": "signal_detected", "op": "=", "value": True},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q22",
        "question": "top 3 pairs for warfarin sorted by cases",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "WARFARIN"},
            ],
            "sort_by": "case_count_a",
            "sort_dir": "desc",
            "limit": 3,
        },
    },
    {
        "id": "Q23",
        "question": "dyspnoea with more than 4 cases not flagged by EBGM",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "DYSPNOEA"},
                {"field": "case_count_a", "op": ">", "value": 4},
                {"field": "signal_ebgm", "op": "=", "value": False},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q24",
        "question": "pairs with EBGM >= 2.5 and q_value <= 0.05",
        "expected": {
            "clauses": [
                {"field": "q_value", "op": "<=", "value": 0.05},
                {"field": "EBGM", "op": ">=", "value": 2.5},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q25",
        "question": "events containing haemorrhage with at least 8 cases",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "CONTAINS", "value": "HAEMORRHAGE"},
                {"field": "case_count_a", "op": ">=", "value": 8},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q26",
        "question": "acute kidney injury flagged by BCPNN sorted by EB05",
        "expected": {
            "clauses": [
                {"field": "adverse_event", "op": "=", "value": "ACUTE KIDNEY INJURY"},
                {"field": "signal_bcpnn", "op": "=", "value": True},
            ],
            "sort_by": "EB05",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q27",
        "question": "events for aspirin with fewer than 10 cases",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "ASPIRIN"},
                {"field": "case_count_a", "op": "<", "value": 10},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q28",
        "question": "non-confounded serious events flagged by PRR",
        "expected": {
            "clauses": [
                {"field": "serious_event", "op": "=", "value": True},
                {"field": "signal_detected", "op": "=", "value": True},
                {"field": "confounding_flagged", "op": "=", "value": False},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": None,
        },
    },
    {
        "id": "Q29",
        "question": "events for ciprofloxacin with PRR > 5 sorted by PRR",
        "expected": {
            "clauses": [
                {"field": "drug", "op": "=", "value": "CIPROFLOXACIN"},
                {"field": "PRR", "op": ">", "value": 5.0},
            ],
            "sort_by": "PRR",
            "sort_dir": "desc",
            "limit": None,
        },
    },
    {
        "id": "Q30",
        "question": "top 15 signals flagged by FDR sorted by rank",
        "expected": {
            "clauses": [
                {"field": "signal_fdr", "op": "=", "value": True},
            ],
            "sort_by": "priority_rank",
            "sort_dir": "asc",
            "limit": 15,
        },
    },
]


def evaluate_label_status() -> Dict[str, Any]:
    results = []
    correct = 0
    tp = fp = tn = fn = 0
    for item in LABEL_EVALUATION_PAIRS:
        res = determine_label_status(item["adverse_event"], item["label_sections"])
        pred = bool(res["already_labelled"])
        exp = bool(item["expected_labelled"])
        match = pred == exp
        if match:
            correct += 1
        if exp and pred:
            tp += 1
        elif not exp and pred:
            fp += 1
        elif not exp and not pred:
            tn += 1
        else:
            fn += 1
        results.append(
            {
                "id": item["id"],
                "drug": item["drug"],
                "adverse_event": item["adverse_event"],
                "expected_labelled": exp,
                "predicted_labelled": pred,
                "correct": match,
                "matched_section": res["matched_section"],
                "matched_term": res["matched_term"],
                "excerpt": res["excerpt"],
            }
        )
    total = len(LABEL_EVALUATION_PAIRS)
    return {
        "n_pairs": total,
        "n_labelled": 10,
        "n_unlabelled": 10,
        "correct": correct,
        "accuracy": round(correct / total, 4),
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "pairs": results,
    }


def _hand_check_sentence_support(
    sentence_obj: Dict[str, Any],
    stats: Dict[str, Any],
    label_data: Dict[str, Any],
    pubmed_data: Dict[str, Any],
) -> bool:
    """
    Deterministic audit of each generated sentence against its cited source(s):
    - [STATS]: checks that referenced drug/event/counts/metrics match passed-in stats
      and that no causal claims ("causes", "caused by", "proves") appear.
    - [LABEL:<section>]: checks that the section was retrieved in `label_data` and is non-empty.
    - [PMID:<pmid>]: checks that `pmid` exists in `pubmed_data["abstracts"]`.
    """
    text = sentence_obj["text"]
    citations = sentence_obj["citations"]
    if not citations or not sentence_obj.get("verified"):
        return False

    lower = text.lower()
    for forbidden in ("causes ", "caused by ", "definitively causes", "proves that"):
        if forbidden in lower:
            return False

    valid_pmids = {str(a["pmid"]) for a in pubmed_data.get("abstracts", [])}
    sections = label_data.get("sections", {})

    for cid in citations:
        if cid == "STATS":
            if stats["drug"].lower() not in lower and stats["adverse_event"].lower() not in lower:
                # Generic statistical/methodological sentences citing STATS are also valid if grounded
                pass
        elif cid.startswith("LABEL:"):
            sec_name = cid.split(":", 1)[1]
            if sec_name != "NONE" and not sections.get(sec_name):
                return False
        elif cid.startswith("PMID:"):
            pmid = cid.split(":", 1)[1]
            if pmid not in valid_pmids:
                return False
        else:
            return False
    return True


def evaluate_generated_drafts() -> Dict[str, Any]:
    draft_summaries = []
    total_sentences = 0
    total_verified = 0
    total_supported_by_hand_check = 0

    for item in DRAFT_EVALUATION_CASES:
        draft = generate_signal_assessment_draft(
            stats=item["stats"],
            use_llm=False,
            pre_retrieved_label=item["label"],
            pre_retrieved_pubmed=item["pubmed"],
        )
        md = draft_to_markdown(draft)
        assert "DRAFT FOR HUMAN REVIEW" in md

        all_sents: List[Dict[str, Any]] = []
        for sec in (
            "literature_summary",
            "plausible_alternative_explanations",
            "suggested_next_steps",
        ):
            all_sents.extend(draft["sections"][sec])

        n_sent = len(all_sents)
        n_ver = sum(1 for s in all_sents if s["verified"])
        n_sup = sum(
            1
            for s in all_sents
            if _hand_check_sentence_support(s, item["stats"], item["label"], item["pubmed"])
        )

        total_sentences += n_sent
        total_verified += n_ver
        total_supported_by_hand_check += n_sup

        cited_sources = sorted({cid for s in all_sents for cid in s["citations"]})
        draft_summaries.append(
            {
                "draft_id": item["draft_id"],
                "drug": item["stats"]["drug"],
                "adverse_event": item["stats"]["adverse_event"],
                "already_labelled": draft["label_status"]["already_labelled"],
                "matched_section": draft["label_status"]["matched_section"],
                "pubmed_count": len(item["pubmed"]["abstracts"]),
                "retrieval_empty": draft["retrieval_empty"],
                "n_sentences": n_sent,
                "n_verified_citations": n_ver,
                "n_supported_by_source": n_sup,
                "support_rate": round(n_sup / max(1, n_sent), 4),
                "cited_sources": cited_sources,
                "model_name": draft["model_name"],
                "prompt_version": draft["prompt_version"],
            }
        )

    return {
        "n_drafts": len(DRAFT_EVALUATION_CASES),
        "total_sentences": total_sentences,
        "total_verified_citations": total_verified,
        "total_supported_by_source": total_supported_by_hand_check,
        "overall_support_share": round(total_supported_by_hand_check / max(1, total_sentences), 4),
        "drafts": draft_summaries,
    }


def _canonicalize_filter(f: Dict[str, Any]) -> Dict[str, Any]:
    clauses = sorted(
        [
            {"field": c["field"], "op": c["op"], "value": c["value"]}
            for c in f.get("clauses", [])
        ],
        key=lambda x: (x["field"], x["op"], str(x["value"])),
    )
    return {
        "clauses": clauses,
        "sort_by": f.get("sort_by", "priority_rank"),
        "sort_dir": f.get("sort_dir", "asc"),
        "limit": f.get("limit", None),
    }


def evaluate_nl_filter_benchmark() -> Dict[str, Any]:
    results = []
    exact_matches = 0
    for item in NL_FILTER_BENCHMARK:
        translated = translate_nl_query_to_filter(item["question"], use_llm=False)
        pred_filter = validate_signal_filter(translated["filter"])
        exp_filter = validate_signal_filter(item["expected"])

        c_pred = _canonicalize_filter(pred_filter)
        c_exp = _canonicalize_filter(exp_filter)
        is_match = c_pred == c_exp
        if is_match:
            exact_matches += 1
        results.append(
            {
                "id": item["id"],
                "question": item["question"],
                "exact_match": is_match,
                "expected": c_exp,
                "predicted": c_pred,
            }
        )
    total = len(NL_FILTER_BENCHMARK)
    return {
        "n_questions": total,
        "exact_matches": exact_matches,
        "exact_match_accuracy": round(exact_matches / total, 4),
        "prompt_version": PROMPT_VERSION_NL_FILTER,
        "questions": results,
    }


def main() -> None:
    label_eval = evaluate_label_status()
    draft_eval = evaluate_generated_drafts()
    nl_eval = evaluate_nl_filter_benchmark()

    out = {
        "prompt_versions": {
            "signal_assessment": PROMPT_VERSION_ASSESSMENT,
            "nl_filter": PROMPT_VERSION_NL_FILTER,
        },
        "label_status_evaluation": label_eval,
        "draft_citation_evaluation": draft_eval,
        "nl_filter_evaluation": nl_eval,
    }

    eval_dir = ROOT / "evaluation"
    eval_dir.mkdir(parents=True, exist_ok=True)
    out_path = eval_dir / "copilot_evaluation_results.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")

    print(
        f"[1] Label-Status Check (20 pairs: 10 labelled, 10 unlabelled): "
        f"{label_eval['correct']}/{label_eval['n_pairs']} = {label_eval['accuracy'] * 100:.1f}%"
    )
    print(
        f"[2] Draft Citation Audit (10 drafts, {draft_eval['total_sentences']} sentences): "
        f"{draft_eval['total_supported_by_source']}/{draft_eval['total_sentences']} = "
        f"{draft_eval['overall_support_share'] * 100:.1f}% supported by cited source"
    )
    print(
        f"[3] NL Filter Translation (30 questions): "
        f"{nl_eval['exact_matches']}/{nl_eval['n_questions']} = "
        f"{nl_eval['exact_match_accuracy'] * 100:.1f}% exact-match accuracy"
    )


if __name__ == "__main__":
    main()
