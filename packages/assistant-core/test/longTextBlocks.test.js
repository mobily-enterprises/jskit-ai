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
    ["Shall I start Step 1 (the solo check and gap list) now?", 2],
    ["For Step 2, how would you like to work?", 3]
  ]);
  assert.equal(prompt.outro, "");

  assert.deepEqual(outline(parseLongTextReviewBlocks(prompt.intro)), [
    "paragraph: Here's how I'd run a final check of the ",
    "paragraph: **Step 1: I check on my own (no need for",
    {
      ul: [
        "**Try every screen.** I open every scree",
        {
          "**Gather the \"open question\" lists.** Ev": [
            { ul: ["**I can check it now:** for example, ren", "**Needs you:** real accounts, printing, ", "**Can't be checked at all.**"] }
          ]
        },
        "**Output:** one gap list, saved to the s"
      ]
    },
    "paragraph: **Step 2: a session with you, for the \"n",
    {
      ul: [
        "**You use the planner on your own comput",
        "**I take notes as you go** and capture s",
        "**Things outside the planner itself:** p",
        {
          "**What I need from you:**": [
            { ul: ["which features you know or suspect exist", "the test account, so I can see the real ", "your call on anything that sends real da"] }
          ]
        }
      ]
    },
    "paragraph: **Step 3: I tidy up**",
    {
      ul: [
        {
          "**For the design notes:**": [
            { ul: ["Newly found screens go into the notes as", "Each one gets a short note, written when"] }
          ]
        },
        "**For you:** a final coverage summary."
      ]
    },
    "paragraph: **One thing to keep in mind:** some scre"
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
