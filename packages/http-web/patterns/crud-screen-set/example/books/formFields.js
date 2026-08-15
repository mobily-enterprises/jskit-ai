const bookFormFields = Object.freeze([
  Object.freeze({
    key: "title",
    label: "Title",
    type: "string",
    nullable: false,
    inputType: "text",
    component: "text",
    maxLength: 255
  }),
  Object.freeze({
    key: "author",
    label: "Author",
    type: "string",
    nullable: false,
    inputType: "text",
    component: "text",
    maxLength: 255
  }),
  Object.freeze({
    key: "notes",
    label: "Notes",
    type: "string",
    nullable: true,
    inputType: "textarea",
    component: "textarea",
    maxLength: 65535
  })
]);

export { bookFormFields };
