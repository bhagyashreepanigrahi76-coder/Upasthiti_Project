// App-wide display settings. College-specific values come from env so the
// same build can be deployed for another college.

export const APP_NAME = "College Attendance Portal";
export const COLLEGE_NAME = process.env.NEXT_PUBLIC_COLLEGE_NAME || "Demo College of Arts & Science";

// All dates are shown in the college's local time zone.
export const TIME_ZONE = process.env.NEXT_PUBLIC_TIME_ZONE || "Asia/Kolkata";

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const longDateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export const formatDateTime = (d: Date) => dateTimeFmt.format(d);
export const formatLongDate = (d: Date) => longDateFmt.format(d);
