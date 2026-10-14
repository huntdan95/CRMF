/**
 * The liability waiver guests sign online at /waiver/[bookingId].
 *
 * Source: the insurer's form Travis printed, CSR/WAV/23-1 ("Contractual
 * Assumption Acknowledgement of Risks and Liability Waiver and Release
 * Agreement"), with its drafting footnotes filled in and its typos fixed.
 * Changes from that form, all for Florida law or for signing online:
 *
 *  - Each adult signs their own copy (the form's footnote ix already
 *    required one per participant), so the adult sections speak only for
 *    the signer.
 *  - Minors are covered by a separate Florida Minor Participant Addendum
 *    with the notice § 744.301(3), Florida Statutes, requires, word for
 *    word, and a release limited to inherent risks. A parent's pre-injury
 *    release of a child's claims against a commercial operator is only
 *    enforceable in Florida on those terms (Kirton v. Fields, 997 So. 2d
 *    349 (Fla. 2008), and the 2010 amendment that followed it). The paper
 *    form had neither, and released negligence on the child's behalf.
 *  - "Or otherwise responsible" adults can't sign for a child: the statute
 *    only empowers natural guardians (parents), so the form now says
 *    parent or legal guardian.
 *  - The instructions paragraph is worded for signing before the trip,
 *    when the safety briefing hasn't happened yet.
 *  - Manatee-tour risks (9)–(13) were added, as footnote ii asks.
 *  - Severability, an electronic-signature consent, and the vessel's
 *    owners and crew as releasees were added.
 *  - 2026-10-14 hardening: a plain-language summary and the right to
 *    refuse at the top; the Releasees defined once, by name (Captain
 *    Travis Urbin included) and without the cruise-line releasees; one
 *    venue; gross negligence and intentional misconduct carved out; the
 *    indemnity and fee clause limited to the signer's own released claims
 *    and kept away from minors' claims; the negligence release behind
 *    RELEASE_COVERS_NEGLIGENCE. See ATTORNEY notes below.
 *
 * NOT YET REVIEWED BY A LAWYER. Have a Florida attorney with maritime
 * experience, and the insurer, approve this text, then fill in
 * WAIVER_REVIEW. Any change to the wording must bump WAIVER_VERSION:
 * signed records store the version and a hash of the exact text shown.
 */

export const WAIVER_VERSION = '2026-10-14';
export const WAIVER_BASED_ON = 'CSR/WAV/23-1';

/** Exactly as named on the insurance policy (footnotes i, vi, viii). */
export const RELEASED_PARTY = 'Crystal River Manatee Fun LLC';

/** The owner and captain, released by name as well as by role. */
export const OWNER_NAME = 'Travis Urbin';

/*
 * ATTORNEY DECISIONS. Each is one line; changing any of them changes the
 * wording, so bump WAIVER_VERSION with it.
 */

/**
 * Whether the adult release and assumption of risk cover the Releasees'
 * own ordinary negligence. `false` keeps the release to the risks of the
 * activity and says in so many words that negligence claims are kept.
 * Gross negligence and intentional misconduct are never released either
 * way. The minor addendum is unaffected: it is limited to inherent risks
 * by § 744.301(3) whatever this says.
 */
export const RELEASE_COVERS_NEGLIGENCE = true;

/**
 * The marina the boat leaves from, when the attorney wants it among the
 * Releasees (its own waiver, lease, or insurance may require it). `null`
 * leaves it out. Use its exact legal name.
 */
export const MARINA_RELEASEE: string | null = null;

/**
 * How long signed waivers, their PDFs and signature images are kept.
 * Nothing in the code deletes them, and the files are under a Cloud
 * Storage hold. Florida's negligence limit is 2 years (§ 95.11(4)(a),
 * since 2023), a maritime injury claim's is 3 (46 U.S.C. § 30106), and a
 * minor's can be tolled for years (§ 95.051). ATTORNEY: confirm.
 */
export const WAIVER_RETENTION =
  'at least 7 years after the tour, and for a child until at least 7 years after they turn 18';

/**
 * Who approved this version of the text, and when. `null` until a lawyer
 * has; the admin waivers page shows a reminder while it is.
 */
export const WAIVER_REVIEW: { reviewedBy: string; reviewedOn: string } | null = null;

export const WAIVER_TITLE =
  'Contractual Assumption, Acknowledgement of Risks, and Liability Waiver and Release Agreement';

export const MINOR_ADDENDUM_TITLE = 'Florida Minor Participant Addendum';

export interface WaiverSection {
  /** Stable id; signed records key their initials by it. */
  id: string;
  heading: string | null;
  paragraphs: string[];
  /** Numbered items, rendered "(1) …" after the paragraphs. */
  items?: string[];
  /** Closing paragraphs after `items`. */
  after?: string[];
  /** The signer must initial this section. */
  initials: boolean;
  /** Shown boxed and bold, on the page and in the PDF (the plain summary). */
  callout?: boolean;
  /**
   * The § 744.301(3)(b) notice: must be uppercase and at least 5 points
   * larger than every other piece of the waiver's text, wherever it's
   * rendered. See NOTICE_SIZE in the page and PDF.
   */
  statutoryNotice?: boolean;
}

const P = RELEASED_PARTY;
const P_UPPER = RELEASED_PARTY.toUpperCase();
const NEG = RELEASE_COVERS_NEGLIGENCE;

/** Who the adult release protects. Defined once, used by name everywhere. */
const RELEASEES: string[] = [
  `${P}, and its owners, members, managers, officers, employees, agents, and volunteers, including Captain ${OWNER_NAME};`,
  'the captains and crew of the Charter;',
  'the vessels used in the Charter, and their owners and operators;',
  ...(MARINA_RELEASEE
    ? [`${MARINA_RELEASEE}, the marina the Charter departs from, and its owners and employees;`]
    : []),
  'each landowner and governmental agency on whose property or waters the Charter takes place; and',
  'the insurers of each of them.',
];

export const AGREEMENT_SECTIONS: WaiverSection[] = [
  {
    id: 'summary',
    heading: 'Please read: this is a legal release',
    initials: false,
    callout: true,
    paragraphs: [
      `This is a contract. By signing it you accept the risks of the manatee tour, including the risk of serious injury or death, and you give up your right to sue ${P}, Captain ${OWNER_NAME}, the crew, and the others listed below if you are hurt${
        NEG ? ', even if they were careless (negligent)' : ' by those risks'
      }. Read every section before you initial it.`,
      'You do not have to sign. If you do not sign, you cannot go on the tour. If you have questions, ask Travis before you sign.',
    ],
  },
  {
    id: 'consideration',
    heading: null,
    initials: false,
    paragraphs: [
      `IN CONSIDERATION of being permitted to participate in the guided manatee swim and snorkel tour provided by ${P} (the "Charter"), for myself and for my heirs, personal representatives, and assigns, I agree as follows.`,
      `This Agreement covers my own participation and my own claims. If I sign for a minor child, the ${MINOR_ADDENDUM_TITLE} is part of this Agreement and alone governs the release of claims on that child's behalf.`,
    ],
  },
  {
    id: 'releasees',
    heading: 'Who this Agreement protects (the "Releasees")',
    initials: false,
    paragraphs: ['In this Agreement, the "Releasees" are:'],
    items: RELEASEES,
  },
  {
    id: 'risks',
    heading: 'Acknowledgement of risks',
    initials: true,
    paragraphs: [
      'I fully acknowledge that some, but not all, of the risks of participating in the Charter in which I am about to engage may include:',
    ],
    items: [
      'wind shear, inclement weather, lightning, and variances and extremes of wind, weather, and temperature;',
      'my sense of balance, physical condition, and ability to operate equipment, swim, and/or follow directions;',
      'collision, capsizing, sinking, or other hazard which may result in wetness, injury, exposure to the elements, hypothermia, impact of the body upon the water, injection of water into my body orifices, and/or drowning;',
      'the presence of, and/or injury, illness, or death resulting from, insects, animals, and marine life forms;',
      'equipment failure, operator error, and transportation accidents;',
      'heat- or sun-related injuries or illness, including sunburn, sunstroke, or dehydration;',
      'fatigue, chill, and/or dizziness, which may diminish my reaction time and increase the risk of an accident;',
      'slippery decks and/or steps when wet;',
      'swimming and snorkeling in open, natural water, including cold water, currents and tides, limited or changing visibility, submerged objects such as rocks, logs, and vegetation, and passing boat traffic;',
      'wearing a wetsuit, mask, snorkel, and fins, including restricted movement or breathing, swallowing or inhaling water, mask squeeze, and equipment that loosens, leaks, or fits poorly;',
      'close encounters with manatees and other wildlife, including fish, birds, snakes, alligators, jellyfish, and other biting or stinging creatures, any of which may move, bump, bite, or sting without warning;',
      'boarding, leaving, and moving about the boat, including from docks, ladders, and swim platforms, and the motion of the boat in wakes and waves; and',
      'the distance from medical facilities and emergency services while on the water, which may delay rescue and treatment.',
    ],
  },
  {
    id: 'instructions',
    heading: 'Instructions and ability',
    initials: true,
    paragraphs: [
      'I specifically acknowledge that I will be given instructions in the safe use of the type of equipment used during this Charter before I enter the water, and I agree that I will not enter the water until I have received those instructions to my complete satisfaction and understand them fully. I agree to follow the instructions of the captain and crew at all times. I am physically and mentally able to participate in the Charter in which I am about to engage.',
    ],
  },
  {
    id: 'health',
    heading: 'Health statement',
    initials: true,
    paragraphs: [
      'I understand that past or present medical conditions may be contraindicative to my participation in the Charter. I affirm that I am not currently suffering from a cold or congestion or have an ear infection. I affirm that I do not have any infectious disease or illness (e.g., COVID or similar variants). I affirm that I do not have a history of seizures, dizziness, or fainting, nor a history of heart conditions (e.g., cardiovascular disease, angina, heart attack). I further affirm that I do not have a history of respiratory problems (e.g., emphysema or tuberculosis). I affirm that I am not currently suffering from back, spine, and/or neck injuries. I affirm that I am not currently taking medication that carries a warning about any impairment of my physical or mental abilities. If any of these statements stops being true before the Charter, I will tell the captain before boarding.',
    ],
  },
  {
    id: 'assumption',
    heading: 'Express assumption of risk',
    initials: true,
    paragraphs: [
      `My participation in the Charter is completely voluntary. I knowingly and voluntarily assume all risks of the Charter, known and unknown, whether or not they are listed above${
        NEG
          ? ', INCLUDING RISKS ARISING FROM THE NEGLIGENCE OF ANY OF THE RELEASEES'
          : ', but not risks arising from the negligence of any of the Releasees'
      }. I accept full responsibility for any bodily injury, illness, paralysis, death, or loss of or damage to my personal property, and the expenses of any of them, that result from those risks.`,
    ],
  },
  {
    id: 'release',
    heading: 'RELEASE OF LIABILITY',
    initials: true,
    paragraphs: [
      `I RELEASE AND FOREVER DISCHARGE THE RELEASEES FROM ANY AND ALL CLAIMS, DEMANDS, AND LIABILITY FOR PERSONAL INJURY, ILLNESS, DEATH, OR PROPERTY DAMAGE OR LOSS THAT I SUFFER ARISING OUT OF OR RELATED TO MY PARTICIPATION IN THE CHARTER, ${
        NEG
          ? 'INCLUDING CLAIMS ARISING FROM THE NEGLIGENCE OF ANY OF THE RELEASEES'
          : 'EXCEPT CLAIMS ARISING FROM THE NEGLIGENCE OF ANY OF THE RELEASEES'
      }, AND I AGREE NOT TO SUE ANY OF THE RELEASEES ON ANY CLAIM I HAVE RELEASED.`,
      'This release does not apply to gross negligence or intentional misconduct, or to any claim that applicable law does not allow to be released.',
    ],
  },
  {
    id: 'indemnity',
    heading: 'Indemnity',
    initials: true,
    paragraphs: [
      'If I, or anyone acting on my behalf, sues any of the Releasees on a claim I have released in this Agreement, I agree to indemnify and hold harmless that Releasee from that claim, including its reasonable attorney fees and costs. This paragraph does not apply to any claim of a minor child, or to any claim arising from a minor child’s injury.',
    ],
  },
  {
    id: 'law',
    heading: 'Governing law and venue',
    initials: false,
    paragraphs: [
      'This Agreement is governed by the laws of the State of Florida and, where it applies, the general maritime law of the United States. Any lawsuit relating to the Charter or to this Agreement must be brought only in the state courts in and for Citrus County, Florida, or in the United States District Court for the Middle District of Florida, Ocala Division.',
      'If any part of this Agreement is held to be invalid or unenforceable, the rest of it shall continue in full force and effect, and the invalid part shall be enforced to the fullest extent permitted by law.',
    ],
  },
  {
    id: 'acknowledgement',
    heading: 'Acknowledgement',
    initials: true,
    paragraphs: [
      `I HAVE READ THIS AGREEMENT, I UNDERSTAND IT, AND I SIGN IT VOLUNTARILY. I UNDERSTAND THAT IT IS A CONTRACT THAT BINDS ME, AND THAT BY SIGNING IT I GIVE UP SUBSTANTIAL LEGAL RIGHTS, INCLUDING MY RIGHT TO SUE THE RELEASEES${
        NEG ? ' FOR THEIR NEGLIGENCE' : ' FOR THE RISKS OF THE CHARTER'
      }. I understand that I do not have to sign it, and that if I do not, I will not be allowed to participate in the Charter.`,
    ],
  },
];

/**
 * § 744.301(3)(b), Florida Statutes, with the released party's name in
 * the three "(name of released party or parties)" blanks.
 *
 * ATTORNEY: NOT VERIFIED WORD FOR WORD. The 2025 statute at flsenate.gov
 * couldn't be opened from the environment this was last edited in
 * (2026-10-14), so this text could only be checked against partial
 * quotations. Compare it with the current statute before approving.
 * The statute also requires it in uppercase, at least 5 points larger
 * than, and clearly distinguishable from, the rest of the text: the page
 * and the PDF set it bold, boxed, and at NOTICE_SIZE.
 * Do not edit the wording except to match the statute.
 */
export const STATUTORY_MINOR_NOTICE_HEADING = 'NOTICE TO THE MINOR CHILD’S NATURAL GUARDIAN';

/**
 * The name in the notice's blanks. ATTORNEY: the LLC alone, or the LLC and
 * Captain Travis Urbin ("CRYSTAL RIVER MANATEE FUN LLC AND TRAVIS URBIN")?
 * The statute's release covers the provider's owners, employees, and
 * agents either way.
 */
const NOTICE_PARTY = P_UPPER;

export const STATUTORY_MINOR_NOTICE =
  `READ THIS FORM COMPLETELY AND CAREFULLY. YOU ARE AGREEING TO LET YOUR MINOR CHILD ENGAGE IN A POTENTIALLY DANGEROUS ACTIVITY. YOU ARE AGREEING THAT, EVEN IF ${NOTICE_PARTY} USES REASONABLE CARE IN PROVIDING THIS ACTIVITY, THERE IS A CHANCE YOUR CHILD MAY BE SERIOUSLY INJURED OR KILLED BY PARTICIPATING IN THIS ACTIVITY BECAUSE THERE ARE CERTAIN DANGERS INHERENT IN THE ACTIVITY WHICH CANNOT BE AVOIDED OR ELIMINATED. BY SIGNING THIS FORM YOU ARE GIVING UP YOUR CHILD’S RIGHT AND YOUR RIGHT TO RECOVER FROM ${NOTICE_PARTY} IN A LAWSUIT FOR ANY PERSONAL INJURY, INCLUDING DEATH, TO YOUR CHILD OR ANY PROPERTY DAMAGE THAT RESULTS FROM THE RISKS THAT ARE A NATURAL PART OF THE ACTIVITY. YOU HAVE THE RIGHT TO REFUSE TO SIGN THIS FORM, AND ${NOTICE_PARTY} HAS THE RIGHT TO REFUSE TO LET YOUR CHILD PARTICIPATE IF YOU DO NOT SIGN THIS FORM.`;

/**
 * Who may sign the addendum for a child, as the signer states it for each
 * child. § 744.301(3) empowers "natural guardians"; a court-appointed
 * guardian's authority comes from the appointment. ATTORNEY: whether to
 * accept legal guardians here at all.
 */
export const GUARDIAN_RELATIONSHIPS = {
  parent: 'Parent',
  'legal-guardian': 'Court-appointed legal guardian',
} as const;
export type GuardianRelationship = keyof typeof GUARDIAN_RELATIONSHIPS;

/**
 * Releases only what § 744.301(3) lets a parent release: inherent risks.
 * Keep provider negligence (operator error, poor maintenance, …) out of
 * the inherent-risk list here. Waiving more than the statute allows loses
 * the presumption of validity in § 744.301(3)(c).
 */
export const MINOR_ADDENDUM_SECTIONS: WaiverSection[] = [
  {
    id: 'minor-notice',
    heading: STATUTORY_MINOR_NOTICE_HEADING,
    initials: false,
    statutoryNotice: true,
    paragraphs: [STATUTORY_MINOR_NOTICE],
  },
  {
    id: 'minor-release',
    heading: 'Waiver and release for a minor child',
    initials: true,
    paragraphs: [
      'I am the parent or court-appointed legal guardian of each minor child named in this Addendum, as I have stated next to the child’s name, and I have the legal authority to sign it on each child’s behalf.',
      `In consideration of ${P} allowing each minor child named in this Addendum to participate in the Charter, I, on behalf of each such child and on my own behalf, waive and release, in advance, any claim or cause of action against ${P}, or its owners (including Captain ${OWNER_NAME}), affiliates, employees, or agents, which would accrue to the minor child for personal injury, including death, and property damage resulting from an inherent risk in the activity.`,
      '"Inherent risk" means those dangers or conditions, known or unknown, which are characteristic of, intrinsic to, or an integral part of the activity and which are not eliminated even if the activity provider acts with due care in a reasonably prudent manner. The term includes, but is not limited to: (a) the failure by the activity provider to warn the natural guardian or minor child of an inherent risk; and (b) the risk that the minor child or another participant in the activity may act in a negligent or intentional manner and contribute to the injury or death of the minor child. A participant does not include the activity provider or its owners, affiliates, employees, or agents.',
      'The inherent risks of the Charter include, among others:',
    ],
    items: [
      'weather and water conditions, including wind, waves, currents, temperature, and visibility;',
      'cold water, chill, and hypothermia; and heat, sun, sunburn, and dehydration;',
      'swimming and snorkeling, including swallowing or inhaling water, fatigue, cramps, panic, and drowning;',
      'wearing a wetsuit, mask, snorkel, and fins, including restricted movement or breathing;',
      'manatees and other wildlife, including fish, birds, insects, snakes, alligators, and jellyfish;',
      'the motion of the boat, wet and slippery surfaces, and boarding and leaving the boat;',
      'submerged objects and other boat traffic;',
      'the distance from medical care while on the water; and',
      'the child’s own actions, and the actions of other participants.',
    ],
    after: [
      'To the best of my knowledge, each minor child meets the Health Statement in this Agreement as if it were made about the child, and I will tell the captain before the Charter about any medical condition the child has. I will make sure each minor child is supervised throughout the Charter by me or by the adult named in this Addendum, and follows the instructions of the captain and crew.',
      'Nothing in the Agreement’s assumption of risk, release, or indemnity applies to any claim of a minor child, or to any claim I have arising from a minor child’s injury; those claims are released only as this Addendum provides. This Addendum is intended to comply with section 744.301(3), Florida Statutes, waives no more than that section allows, and shall be interpreted accordingly. As to each minor child’s claims, this Addendum controls over any other part of this Agreement.',
    ],
  },
];

/**
 * Agreed to before the signer initials anything: the initials are
 * electronic signatures too. Covers what 15 U.S.C. § 7001(c) asks of
 * consumer consent (paper option, withdrawal, copies, what's needed to
 * read the record) even where it isn't strictly required.
 */
export const ESIGN_CONSENT = `CONSENT TO SIGN ELECTRONICALLY. I agree to use an electronic record and electronic signatures for this Agreement. My electronic initials and signature are my legal initials and signature and have the same force and effect as if signed by hand in ink (section 668.50, Florida Statutes; 15 U.S.C. § 7001 et seq.). To read and keep this Agreement I need a device that can open web pages and PDF files, and an email address. A PDF copy of the signed Agreement will be emailed to me, and I may ask ${P} for a paper copy at no charge. I do not have to sign electronically: until I sign, I may withdraw this consent and sign a paper copy of this same Agreement before the Charter instead.`;

export const SIGNING_ATTESTATION =
  'By signing below I confirm that I am at least 18 years old; that I am the person named above and I am signing for myself, not for any other adult; that I have read this entire Agreement (and the Florida Minor Participant Addendum, if included) and had the chance to ask questions about it; that I understand I am giving up legal rights; and that I am signing it voluntarily.';

export interface WaiverDocument {
  version: string;
  title: string;
  sections: WaiverSection[];
  /** Present only when the signer is signing for one or more minors. */
  minorAddendum: WaiverSection[] | null;
  esignConsent: string;
  attestation: string;
}

export function waiverDocument({ withMinors }: { withMinors: boolean }): WaiverDocument {
  return {
    version: WAIVER_VERSION,
    title: WAIVER_TITLE,
    sections: AGREEMENT_SECTIONS,
    minorAddendum: withMinors ? MINOR_ADDENDUM_SECTIONS : null,
    esignConsent: ESIGN_CONSENT,
    attestation: SIGNING_ATTESTATION,
  };
}

/** Every section a signer of this document must initial, in order. */
export function initialedSections(doc: WaiverDocument): WaiverSection[] {
  return [...doc.sections, ...(doc.minorAddendum ?? [])].filter((s) => s.initials);
}

function sectionText(s: WaiverSection): string {
  return [
    s.heading ?? '',
    ...s.paragraphs,
    ...(s.items ?? []).map((item, i) => `(${i + 1}) ${item}`),
    ...(s.after ?? []),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The document's exact wording as one string. Signed records store its
 * SHA-256, so the text a guest saw can be proven later.
 */
export function waiverPlainText(doc: WaiverDocument): string {
  return [
    `${doc.title} (version ${doc.version})`,
    ...doc.sections.map(sectionText),
    ...(doc.minorAddendum
      ? [MINOR_ADDENDUM_TITLE.toUpperCase(), ...doc.minorAddendum.map(sectionText)]
      : []),
    doc.esignConsent,
    doc.attestation,
  ].join('\n\n');
}
