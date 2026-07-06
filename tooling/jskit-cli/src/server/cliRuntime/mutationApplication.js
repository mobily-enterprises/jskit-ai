export {
  applyFileMutations,
  prepareFileMutations
} from "./mutations/fileMutations.js";

export {
  applyTextMutations,
  partitionPreFileConfigTextMutations,
  resolvePositioningMutations
} from "./mutations/textMutations.js";

export {
  applySourceMutations,
  partitionPreFileConfigSourceMutations,
  resolvePositioningSourceMutations
} from "./mutations/sourceMutations.js";
