export type JournalTemplate = {
  id: string;
  title: string;
  body: string;
};

export const JOURNAL_TEMPLATE_LIBRARY: JournalTemplate[] = [
  {
    id: 'race_day',
    title: 'Race day reflection',
    body: `Before: How did you feel lining up? Nerves, energy, focus?

During: What surprised you? Where did you execute the plan — and where did you improvise?

After: What are you proud of? What would you do differently next time?`,
  },
  {
    id: 'injury',
    title: 'Injury / setback log',
    body: `What happened (when, where, what you were doing)?

How does it feel now (pain level, location, what makes it better/worse)?

Next steps (rest, physio, cross-training, follow-up date)?`,
  },
  {
    id: 'gear',
    title: 'Gear review',
    body: `What did you use (shoes, wetsuit, bike, watch, nutrition)?

How did it perform in key moments?

Would you recommend it — and to whom?`,
  },
  {
    id: 'nutrition',
    title: 'Nutrition experiment',
    body: `What did you eat/drink? When relative to the session?

How did you feel during the session (gut, energy, cramps)?

What would you repeat or change next time?`,
  },
  {
    id: 'general',
    title: 'General training note',
    body: `What went well today?

What was hard — physically or mentally?

What did you learn for the next session?`,
  },
];
