import { firefliesDefinition } from "../shared/tokens.js";
import { graphqlOperation } from "./graphqlOperation.js";

const firefliesProvider = Object.freeze({
  ...firefliesDefinition, apiOrigins: ["https://api.fireflies.ai"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "profile.read",
  operations: {
    "profile.read": graphqlOperation("https://api.fireflies.ai/graphql", "query ConnectorUser { user { user_id name email } }", {},
      (data) => typeof data?.user?.user_id === "string"),
    "transcripts.get": graphqlOperation("https://api.fireflies.ai/graphql",
      "query ConnectorTranscript($id: String!) { transcript(id: $id) { id title date duration participants calendar_type meeting_link transcript_url speakers { id name } sentences { index speaker_name speaker_id text start_time end_time } summary { keywords action_items outline overview } } }", {
        id: { type: "string", required: true, minLength: 1, maxLength: 256 }
      }, data => typeof data?.transcript?.id === "string" && (data.transcript.sentences === null || Array.isArray(data.transcript.sentences))),
    "transcripts.search": graphqlOperation("https://api.fireflies.ai/graphql",
      "query ConnectorSearch($keyword: String!, $scope: TranscriptsQueryScope!, $limit: Int!, $skip: Int!, $mine: Boolean!) { transcripts(keyword: $keyword, scope: $scope, limit: $limit, skip: $skip, mine: $mine) { id title date duration participants } }", {
        keyword: { type: "string", required: true, minLength: 1, maxLength: 255 },
        scope: { type: "string", enum: ["title", "sentences", "all"], defaultTo: "all" },
        limit: { type: "integer", min: 1, max: 50, defaultTo: 25 },
        skip: { type: "integer", min: 0, max: 2147483647, defaultTo: 0 },
        mine: { type: "boolean", defaultTo: true }
      }, data => Array.isArray(data?.transcripts)),
    "transcripts.list": graphqlOperation("https://api.fireflies.ai/graphql",
      "query ConnectorTranscripts($limit: Int!, $skip: Int!, $mine: Boolean!) { transcripts(limit: $limit, skip: $skip, mine: $mine) { id title } }", {
        limit: { type: "integer", min: 1, max: 50, defaultTo: 25 },
        skip: { type: "integer", min: 0, max: 2147483647, defaultTo: 0 },
        mine: { type: "boolean", defaultTo: true }
      }, (data) => Array.isArray(data?.transcripts))
  }
});
export { firefliesProvider };
