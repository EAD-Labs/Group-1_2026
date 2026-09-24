/*
 * Pyra, the robot the games are told through.
 *
 * Feedback that comes from a character, one that talks about its own code
 * ("my copies went wrong", "you caught my bug"), measurably raised novices'
 * engagement and learning in Gidget (Lee & Ko, 2011). So the games frame the
 * student as helping Pyra, and results arrive in Pyra's words.
 *
 * mood: hello | thinking | happy | proud | oops
 */
const MOUTHS = {
  hello: 'M22 38 Q30 44 38 38',
  thinking: 'M25 40 L35 39',
  happy: 'M21 36 Q30 46 39 36',
  proud: 'M20 35 Q30 48 40 35 Z',
  oops: 'M22 41 Q26 37 30 41 Q34 45 38 41',
};

export default function Pyra({ mood = 'hello', children, small = false }) {
  const closed = mood === 'proud';
  return (
    <div className={`pyra pyra--${mood}${small ? ' pyra--small' : ''}`}>
      <svg className="pyra-bot" viewBox="0 0 60 64" aria-hidden="true" focusable="false">
        <line x1="30" y1="4" x2="30" y2="13" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <circle className="pyra-light" cx="30" cy="5" r="4" />
        <rect x="6" y="13" width="48" height="42" rx="12" fill="currentColor" />
        <rect x="11" y="19" width="38" height="30" rx="8" fill="#fff" />
        {closed ? (
          <>
            <path d="M18 29 Q22 25 26 29" stroke="#232A6E" strokeWidth="2.6" fill="none" strokeLinecap="round" />
            <path d="M34 29 Q38 25 42 29" stroke="#232A6E" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="22" cy="29" r={mood === 'oops' ? 3 : 3.6} fill="#232A6E" />
            <circle cx="38" cy={mood === 'thinking' ? 27 : 29} r={mood === 'oops' ? 3 : 3.6} fill="#232A6E" />
          </>
        )}
        {(mood === 'happy' || mood === 'proud') && (
          <>
            <circle cx="15.5" cy="37" r="2.6" fill="#F26321" opacity="0.55" />
            <circle cx="44.5" cy="37" r="2.6" fill="#F26321" opacity="0.55" />
          </>
        )}
        <path d={MOUTHS[mood] || MOUTHS.hello} stroke="#232A6E" strokeWidth="2.6"
          fill={mood === 'proud' ? '#232A6E' : 'none'} strokeLinecap="round" strokeLinejoin="round" />
        <rect x="16" y="55" width="8" height="6" rx="2" fill="currentColor" />
        <rect x="36" y="55" width="8" height="6" rx="2" fill="currentColor" />
      </svg>
      {children && <p className="pyra-says" aria-live="polite">{children}</p>}
    </div>
  );
}

/** What Pyra says about a finished game. */
export function pyraOnResult(result) {
  const { stars = 0, kind } = result;
  if (kind === 'bugcatch') {
    if (stars === 3) return { mood: 'proud', text: 'Every bugged copy caught, and with the fewest tests. You test like a professional!' };
    if (stars === 2) return { mood: 'happy', text: result.parMet === false ? 'All my bugs caught! Can you do it with fewer tests next time?' : 'All my bugs caught! Try it without hints for the third star.' };
    if (stars === 1) return { mood: 'thinking', text: 'Some of my bugs got away. Look at which inputs would have caught them.' };
    return { mood: 'oops', text: 'My bugs escaped this time. A test only works if you know the right answer, so trace the working function first.' };
  }
  if (kind === 'trace') {
    const streak = result.bestStreak ? ` Best streak: ${result.bestStreak}.` : '';
    if (stars === 3) return { mood: 'proud', text: `You ran my program perfectly in your head!${streak}` };
    if (stars >= 1) return { mood: 'happy', text: `Nearly every step right.${streak} Check the ones that slipped below.` };
    return { mood: 'oops', text: 'Tracing takes practice. Go line by line and write each value down as it changes.' };
  }
  if (stars === 3) return { mood: 'proud', text: 'Perfect, and no hints needed. Three stars!' };
  if (stars === 2) return { mood: 'happy', text: 'Everything right! Do it without hints for the third star.' };
  if (stars === 1) return { mood: 'thinking', text: 'Good going. Look at what slipped, then go for all of it.' };
  return { mood: 'oops', text: 'Not this time. Read the explanations below, then have another go.' };
}
