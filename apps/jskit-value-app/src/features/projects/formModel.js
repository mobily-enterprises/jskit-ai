export const projectStatusOptions = [
  { title: "Draft", value: "draft" },
  { title: "Active", value: "active" },
  { title: "Archived", value: "archived" }
];

export const projectPageSizeOptions = [10, 25, 50];

export function createDefaultProjectForm() {
  return {
    name: "",
    status: "draft",
    owner: "",
    notes: ""
  };
}
