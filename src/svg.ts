// Project path tail (last N segments)
export const projectTail = (project: string | undefined, segments: number): string => {
  if (!project) return "";
  const parts = project.replace(/\/$/, "").split("/");
  return parts.slice(-segments).join("/");
};
