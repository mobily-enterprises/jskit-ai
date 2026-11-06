// The fixture's records: enough contacts that the list scrolls, each pointing at a supplier and back.
const contacts = [
  { id: "ada", name: "Ada Lovelace", supplier: "acme" },
  ...Array.from({ length: 40 }, (_, index) => ({ id: `contact-${index + 1}`, name: `Contact ${index + 1}`, supplier: "globex" }))
];
const suppliers = [
  { id: "acme", name: "Acme Supplies", contact: "ada" },
  { id: "globex", name: "Globex", contact: "contact-1" }
];

const records = Object.freeze({ contacts, suppliers });

export { records };
