import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseLongTextReviewBlocks } from "../src/shared/conversation/longTextBlocks.js";
import { parseNumberedQuestionPrompt } from "../src/shared/conversation/numberedQuestionSugar.js";

const message = readFileSync(new URL("./fixtures/nestedListQuestionMessage.md", import.meta.url), "utf8");

function outline(blocks = []) {
  return blocks.map((block) => {
    if (block.type !== "ul" && block.type !== "ol") {
      return `${block.type}: ${block.text.slice(0, 40)}`;
    }
    return {
      [block.type]: block.items.map((item) => (
        item.blocks ? { [item.text.slice(0, 40)]: outline(item.blocks) } : item.text.slice(0, 40)
      ))
    };
  });
}

test("a question message keeps its intro paragraphs and nested lists apart from the question cards", () => {
  const prompt = parseNumberedQuestionPrompt(message);
  assert.deepEqual(prompt.questions.map((question) => [question.label, question.choices.length]), [
    ["Shall I start Step 1 (the solo sweep and gap list) now?", 2],
    ["For Step 2, how would you like to work?", 3]
  ]);
  assert.equal(prompt.outro, "");

  assert.deepEqual(outline(parseLongTextReviewBlocks(prompt.intro)), [
    "paragraph: Here's how I'd run a final sweep in thre",
    "paragraph: **Step 1: I sweep on my own (no need for",
    {
      ul: [
        "**Click everything.** I go through every",
        {
          "**Gather the \"unverified\" lists.** Every": [
            { ul: ["**I can observe it now:** for example, e", "**Needs you:** real accounts, audio, a s", "**Can't be observed at all.**"] }
          ]
        },
        "**Output:** one gap list, saved to your "
      ]
    },
    "paragraph: **Step 2: a session with you, for the \"n",
    {
      ul: [
        "**You drive the reference over VNC**, us",
        "**I record the screen** at a low frame r",
        "**Things outside the reference machine:*",
        {
          "**What I need from you:**": [
            { ul: ["which features you know or suspect exist", "the test Google account, so I can see th", "your call on anything that sends real da"] }
          ]
        }
      ]
    },
    "paragraph: **Step 3: I tidy up**",
    {
      ul: [
        {
          "**For mercbot:**": [
            { ul: ["Newly discovered areas go to mercbot as ", "Each one gets a spec, sent when you or m"] }
          ]
        },
        "**For you:** a final coverage summary."
      ]
    },
    "paragraph: **One thing to keep in mind:** you'll se"
  ]);
});

test("nested lists follow item content indentation and return to the parent level", () => {
  assert.deepEqual(parseLongTextReviewBlocks([
    "1. First",
    "   - child a",
    "\t- child b",
    "      1) grandchild",
    "2. Second",
    "  - too shallow for the ordered item, so a sibling list item"
  ].join("\n")), [
    {
      items: [
        {
          blocks: [{
            items: [
              { text: "child a" },
              { blocks: [{ items: [{ text: "grandchild" }], type: "ol" }], text: "child b" }
            ],
            type: "ul"
          }],
          text: "First"
        },
        { text: "Second" }
      ],
      type: "ol"
    },
    {
      items: [{ text: "too shallow for the ordered item, so a sibling list item" }],
      type: "ul"
    }
  ]);
});
