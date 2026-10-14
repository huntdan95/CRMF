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
 *
 * NOT YET REVIEWED BY A LAWYER. Have a Florida attorney with maritime
 * experience, and the insurer, approve this text, then fill in
 * WAIVER_REVIEW. Any change to the wording must bump WAIVER_VERSION:
 * signed records store the version and a hash of the exact text shown.
 */

export const WAIVER_VERSION = '2026-10-13';
export const WAIVER_BASED_ON = 'CSR/WAV/23-1';

/** Exactly as named on the insurance policy (footnotes i, vi, viii). */
export const RELEASED_PARTY = 'Crystal River Manatee Fun LLC';

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
  /**
   * The § 744.301(3)(b) notice: must be uppercase and at least 5 points
   * larger than every other piece of the waiver's text, wherever it's
   * rendered. See NOTICE_SIZE in the page and PDF.
   */
  statutoryNotice?: boolean;
}

const P = RELEASED_PARTY;
const P_UPPER = RELEASED_PARTY.toUpperCase();

export const AGREEMENT_SECTIONS: WaiverSection[] = [
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
    heading: 'Contractual / express assumption of risk and responsibility',
    initials: true,
    paragraphs: [
      'I fully agree to assume all responsibility for all the risks of the Charter in which I am about to engage, whether identified above or not (I FULLY UNDERSTAND THAT I UNDERTAKE EVEN THOSE RISKS ARISING OUT OF THE NEGLIGENCE OF THE RELEASEES NAMED BELOW). My participation in the Charter is completely voluntary. I assume full responsibility for myself. This responsibility extends to any bodily injury, accidents, illnesses, paralysis, death, loss of personal property, and expenses thereof as a result of any accident which may occur while I participate in the activity. I COMPLETELY UNDERSTAND AND AGREE TO ACCEPT ALL RESPONSIBILITY ON BEHALF OF MYSELF, EVEN IF THESE INJURIES, DEATH, OR LOSS OF PERSONAL PROPERTY ARE CAUSED IN WHOLE OR IN PART BY THE NEGLIGENCE OF THE RELEASEES NAMED BELOW.',
    ],
  },
  {
    id: 'law',
    heading: 'Governing law and venue',
    initials: false,
    paragraphs: [
      `This Agreement shall be governed by the laws of the State of Florida. Any legal action relating to or arising out of this Agreement against or with respect to ${P} shall be commenced exclusively in Florida. Any legal action relating to or arising out of this Agreement against or with respect to any of ${P}'s affiliated or related companies shall be commenced exclusively in the Circuit Court in and for Citrus County, Florida. I agree that I will reimburse in full any attorney fees incurred by ${P} or its insurers to defend any legal action under this Agreement.`,
      'If any part of this Agreement is held to be invalid or unenforceable, the rest of it shall continue in full force and effect, and the invalid part shall be enforced to the fullest extent permitted by law.',
    ],
  },
  {
    id: 'release',
    heading: 'Release',
    initials: true,
    paragraphs: [
      `I HEREBY RELEASE ${P_UPPER}, ITS AFFILIATED AND RELATED COMPANIES, THEIR PRINCIPALS, DIRECTORS, OFFICERS, AGENTS, EMPLOYEES, AND VOLUNTEERS, THE VESSELS USED IN THE ACTIVITY AND THEIR OWNERS, OPERATORS, CAPTAINS, AND CREW, THEIR INSURERS, AND EACH AND EVERY LANDOWNER, MUNICIPAL AND/OR GOVERNMENTAL AGENCY UPON WHOSE PROPERTY ANY ACTIVITY IS CONDUCTED, AS WELL AS THEIR INSURERS, IF ANY, AND EACH AND EVERY CRUISE LINE OR COMPANY WHO FACILITATED PARTICIPATION AND/OR PURCHASE OF TICKETS (THE "RELEASEES"), FROM ANY AND ALL LIABILITY OF ANY NATURE FOR ANY AND ALL INJURY, PROPERTY LOSS, OR DAMAGE (INCLUDING DEATH) TO ME, AS WELL AS TO OTHER PERSONS, AS A RESULT OF MY PARTICIPATION IN THE ACTIVITY, EVEN IF CAUSED BY MY NEGLIGENCE OR BY THE NEGLIGENCE OF ANY OF THE RELEASEES NAMED ABOVE, OR ANY OTHER PERSON (INCLUDING MYSELF).`,
    ],
  },
  {
    id: 'acknowledgement',
    heading: 'Acknowledgement',
    initials: false,
    paragraphs: [
      'I have read this Assumption and Acknowledgement of Risks and Release of Liability Agreement. I understand fully that it is contractual in nature and binding upon me personally. I further understand that by signing this document I am waiving valuable legal rights, including any and all rights I may have against the owner, the charterer, the operator named above, or their employees, agents, servants, or assigns. I FULLY AGREE, IN CONSIDERATION FOR BEING ALLOWED TO PARTICIPATE IN THE CHARTER, TO HOLD HARMLESS AND INDEMNIFY THE OWNER, THE OPERATOR NAMED ABOVE, OR THEIR EMPLOYEES, AGENTS, SERVANTS, OR ASSIGNS FOR ANY INJURY WHICH MAY BEFALL ME (INCLUDING DEATH).',
    ],
  },
];

/**
 * § 744.301(3)(b), Florida Statutes, verbatim, with the released party's
 * name in the three "(name of released party or parties)" blanks.
 * Checked against the statute as published at flsenate.gov (2025).
 * Do not edit the wording.
 */
export const STATUTORY_MINOR_NOTICE_HEADING = 'NOTICE TO THE MINOR CHILD’S NATURAL GUARDIAN';
export const STATUTORY_MINOR_NOTICE =
  `READ THIS FORM COMPLETELY AND CAREFULLY. YOU ARE AGREEING TO LET YOUR MINOR CHILD ENGAGE IN A POTENTIALLY DANGEROUS ACTIVITY. YOU ARE AGREEING THAT, EVEN IF ${P_UPPER} USES REASONABLE CARE IN PROVIDING THIS ACTIVITY, THERE IS A CHANCE YOUR CHILD MAY BE SERIOUSLY INJURED OR KILLED BY PARTICIPATING IN THIS ACTIVITY BECAUSE THERE ARE CERTAIN DANGERS INHERENT IN THE ACTIVITY WHICH CANNOT BE AVOIDED OR ELIMINATED. BY SIGNING THIS FORM YOU ARE GIVING UP YOUR CHILD’S RIGHT AND YOUR RIGHT TO RECOVER FROM ${P_UPPER} IN A LAWSUIT FOR ANY PERSONAL INJURY, INCLUDING DEATH, TO YOUR CHILD OR ANY PROPERTY DAMAGE THAT RESULTS FROM THE RISKS THAT ARE A NATURAL PART OF THE ACTIVITY. YOU HAVE THE RIGHT TO REFUSE TO SIGN THIS FORM, AND ${P_UPPER} HAS THE RIGHT TO REFUSE TO LET YOUR CHILD PARTICIPATE IF YOU DO NOT SIGN THIS FORM.`;

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
      'I am the parent or legal guardian of each minor child named in this Addendum, and I have the legal authority to sign it on each child’s behalf.',
      `In consideration of ${P} allowing each minor child named in this Addendum to participate in the Charter, I, on behalf of each such child and on my own behalf, waive and release, in advance, any claim or cause of action against ${P}, or its owners, affiliates, employees, or agents, which would accrue to the minor child for personal injury, including death, and property damage resulting from an inherent risk in the activity.`,
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
      'This Addendum is intended to comply with section 744.301(3), Florida Statutes, waives no more than that section allows, and shall be interpreted accordingly. As to each minor child’s claims, this Addendum controls over any other part of this Agreement.',
    ],
  },
];

export const ESIGN_CONSENT = `ELECTRONIC SIGNATURE. I agree to sign this Agreement electronically. My electronic signature, typed name, and initials are my legal signature and initials and have the same force and effect as if signed by hand in ink (section 668.50, Florida Statutes; 15 U.S.C. § 7001 et seq.). A copy of the signed Agreement will be emailed to me, and I may ask ${P} for a paper copy at no charge. If I do not want to sign electronically, I may ask for a paper form to sign before the Charter instead.`;

export const SIGNING_ATTESTATION =
  'By signing below I confirm that I am at least 18 years old, that I have read this entire Agreement (and the Florida Minor Participant Addendum, if included), and that I am signing it voluntarily.';

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
