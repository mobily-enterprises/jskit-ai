import { ref, toRaw } from "vue";

// A list or a plain record holds field values; any other object, such as a Date or a File, is one value.
function isPlainRecord(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// A field's value as it is now, unchanged by a later change to the form's own lists and records.
function copyValue(value) {
  const raw = toRaw(value);
  if (Array.isArray(raw)) {
    return raw.map(copyValue);
  }
  if (isPlainRecord(raw)) {
    return Object.fromEntries(Object.entries(raw).map(([key, entry]) => [key, copyValue(entry)]));
  }
  return raw;
}

function sameValue(left, right) {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, index) => sameValue(entry, right[index]));
  }
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  return false;
}

// Read through the form's proxy, so a field the form holds as a ref copies as its value.
function copyFields(fields) {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, copyValue(fields[key])]));
}

/**
 * What a person has changed in a form and not saved, kept when the record the form edits is read again.
 *
 * Every path that writes fetched data into the form goes through it: `merge(writeLoaded)` for a read of the record,
 * `mergeSaved(writeLoaded, sent)` for a save's response. `writeLoaded` writes what the server sent into a copy of
 * the form, and the form takes from it each field the person has not changed since it last took the server's
 * values. A field they changed keeps their value; when the server's value of it changed meanwhile, `conflicts` lists
 * the field with the server's value until the person takes it (`acceptServerValue`), keeps theirs
 * (`keepOwnValue`), saves it, or types the server's value.
 * @param {{ model: Record<string, unknown> }} options
 */
function useUnsavedEdits({ model }) {
  const initial = copyFields(model);
  // The values the form last took from the server: at first its own initial values.
  let taken = initial;
  /**
   * The record those values came from; a merge from another record starts the form over.
   * @type {string | undefined}
   */
  let takenRecord;
  /** @type {import("vue").Ref<import("../../types.js").EditConflict[]>} */
  const conflicts = ref([]);

  function setConflict(key, value) {
    const index = conflicts.value.findIndex((conflict) => conflict.key === key);
    if (index >= 0 && sameValue(conflicts.value[index].value, value)) {
      return;
    }
    const next = [...conflicts.value];
    next.splice(index >= 0 ? index : next.length, index >= 0 ? 1 : 0, { key, value: copyValue(value) });
    conflicts.value = next;
  }

  function clearConflict(key) {
    if (conflicts.value.some((conflict) => conflict.key === key)) {
      conflicts.value = conflicts.value.filter((conflict) => conflict.key !== key);
    }
  }

  // The form's initial values, as for a record never read: what a new record, or one with no data yet, starts from.
  function reset() {
    for (const key of Object.keys(model)) {
      if (!Object.hasOwn(initial, key)) {
        delete model[key];
      }
    }
    for (const [key, value] of Object.entries(initial)) {
      model[key] = copyValue(value);
    }
    taken = initial;
    takenRecord = undefined;
    conflicts.value = [];
  }

  // Gives the form what `writeLoaded` wrote of the server's values, for each field the person has not changed since
  // `base`, the values the form took last or a save sent.
  function mergeSince(writeLoaded, base) {
    const current = copyFields(model);
    const loaded = { ...current, ...copyFields(base) };
    writeLoaded(loaded);
    for (const [key, value] of Object.entries(loaded)) {
      const mine = current[key];
      if (sameValue(mine, base[key])) {
        // The person has not changed it: it takes the server's value.
        if (!sameValue(mine, value)) {
          model[key] = copyValue(value);
        }
        clearConflict(key);
      } else if (sameValue(mine, value)) {
        // The server now holds what the person typed.
        clearConflict(key);
      } else if (!sameValue(value, base[key])) {
        // The server's value changed under the person's edit: both stay, and the person chooses.
        setConflict(key, value);
      }
    }
    taken = loaded;
  }

  /**
   * A read of the record: its first load, or a read again. A read of another record (its `record`, such as its query
   * key, differs) starts the form over from its initial values.
   * @param {(target: Record<string, unknown>) => void} writeLoaded Writes the server's values into the form's copy.
   * @param {string} [record]
   */
  function merge(writeLoaded, record = takenRecord) {
    if (takenRecord !== undefined && record !== takenRecord) {
      reset();
    }
    mergeSince(writeLoaded, taken);
    takenRecord = record;
  }

  /** The form's values now: what a save sends, which `mergeSaved` then compares its response with. */
  function captureFields() {
    return copyFields(model);
  }

  /**
   * A save's response: the fields the save sent take it, and a field changed while the save ran keeps the person's
   * value.
   * @param {(target: Record<string, unknown>) => void} writeLoaded
   * @param {Record<string, unknown>} sent What `captureFields()` returned when the save started.
   */
  function mergeSaved(writeLoaded, sent) {
    mergeSince(writeLoaded, sent);
  }

  /** The person takes the server's value of a field in conflict. */
  function acceptServerValue(key) {
    const conflict = conflicts.value.find((entry) => entry.key === key);
    if (conflict) {
      model[key] = copyValue(conflict.value);
      clearConflict(key);
    }
  }

  /** The person keeps their own value of a field in conflict; a later change of the server's value raises it again. */
  function keepOwnValue(key) {
    clearConflict(key);
  }

  return {
    conflicts,
    captureFields,
    merge,
    mergeSaved,
    reset,
    acceptServerValue,
    keepOwnValue
  };
}

export { useUnsavedEdits };
