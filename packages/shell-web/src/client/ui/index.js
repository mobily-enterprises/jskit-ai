import ShellUiButton from "./ShellUiButton.vue";
import ShellUiDialog from "./ShellUiDialog.vue";
import { MATERIAL_TEXT, SHELL_UI_KEY, SHELL_UI_ROLES, SHELL_UI_TEXT_ROLES, defineShellUi } from "./shellUi.js";

// The application's design system for JSKIT's views: a view draws its buttons with the kit's Button, its dialogs with
// its Dialog and its text with its text classes. Without a kit, or for a role the kit leaves out, they are Material 3's.
const { provideShellUi, useShellUi } = defineShellUi({ Button: ShellUiButton, Dialog: ShellUiDialog, text: MATERIAL_TEXT });

export { MATERIAL_TEXT, SHELL_UI_KEY, SHELL_UI_ROLES, SHELL_UI_TEXT_ROLES, ShellUiButton, ShellUiDialog, provideShellUi, useShellUi };
