// Privacy notice shown on /privacy and accepted on first sign-in (PRD §7,
// India's DPDP Act 2023). Bump PRIVACY_VERSION when the text changes in a
// way that needs everyone to agree again.

export const PRIVACY_VERSION = "2026-11";

export const PRIVACY_SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "What we collect",
    body: [
      "Your name, college ID, contact details, department, year and section, provided by the college office.",
      "Attendance: campus punch-in and punch-out times, class attendance marked by teachers, leave and regularisation requests, and documents you attach to them.",
      "Marks and results entered by your teachers.",
      "For punches only: your phone's location and GPS accuracy at the moment you tap Punch in or Punch out, a random identifier for the phone you registered, and the time on your phone.",
    ],
  },
  {
    title: "Location",
    body: [
      "Location is read only when you tap a punch button. The app never tracks you in the background.",
      "It is used to check that you are within the campus area, and to detect fake or impossible locations.",
    ],
  },
  {
    title: "Why we use it",
    body: [
      "To record attendance, publish results, approve leave, and send monthly attendance reports and low-attendance alerts to your parents or guardians.",
      "To keep an audit trail of changes to attendance and marks, as the college is required to.",
    ],
  },
  {
    title: "Who can see it",
    body: [
      "You, your parents or guardians linked to your record, your teachers for the subjects they teach, your class coordinator, your head of department, and the college office.",
      "It is not sold or shared with anyone else, except where the law requires it.",
    ],
  },
  {
    title: "How long we keep it",
    body: ["Records are kept while you are a student and afterwards for as long as university and accreditation rules require. Then they are deleted."],
  },
  {
    title: "Your rights",
    body: [
      "You can ask the college office to see the data held about you, correct mistakes, or raise a grievance.",
      "Parents can stop monthly report emails using the link in each email. Critical attendance alerts are always sent.",
    ],
  },
];

/** Students under 18 need a parent or guardian to agree as well (PRD §7). */
export function isUnder18(dateOfBirth: Date | null | undefined, now = new Date()): boolean {
  if (!dateOfBirth) return false;
  const eighteenth = new Date(dateOfBirth);
  eighteenth.setUTCFullYear(eighteenth.getUTCFullYear() + 18);
  return eighteenth > now;
}
