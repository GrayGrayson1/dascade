/**
 * DAS Survey synchronized state (extends the party kit's PartyRoomState).
 *
 * ANONYMITY: nothing here ever says what a player answered. `progress` only tells whether
 * someone answered / predicted; tallies appear in `resultJson` once answering has closed and
 * only when enough players answered (see SURVEY_LIMITS.minRespondents).
 */
import { schema, t, type SchemaType } from '@colyseus/schema';
import { PartyRoomState } from '../party/index.ts';

export const SurveyProgressState = schema(
  {
    answered: t.boolean().default(false),
    predicted: t.boolean().default(false),
  },
  'SurveyProgressState',
);
export type SurveyProgressState = SchemaType<typeof SurveyProgressState>;

export const SurveyState = PartyRoomState.extend(
  {
    q: t.uint32().default(0),
    questionJson: t.string().default(''),
    answersIn: t.uint16().default(0),
    predictionsIn: t.uint16().default(0),
    progress: t.map(SurveyProgressState),
    resultJson: t.string().default(''),
    historyJson: t.string().default('[]'),
    customCount: t.uint16().default(0),
  },
  'SurveyState',
);
export type SurveyState = SchemaType<typeof SurveyState>;
