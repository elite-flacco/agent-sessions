import { redirect } from "next/navigation";

export default function ProjectsPage() {
  redirect("/sessions?view=projects");
}
