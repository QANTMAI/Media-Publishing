import { redirect } from "next/navigation";

/* Handoff #2: Analytics is no longer a standalone screen — its content lives
 * as a section on the Dashboard. This route redirects there so any old link
 * still lands somewhere sensible. */
export default function AnalyticsPage() {
  redirect("/dashboard");
}
