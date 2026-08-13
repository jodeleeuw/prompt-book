import { h, plural } from './dom.js';
import { listScripts, loadScript } from '../store/library.js';
import { getLastRun, clearLastRun } from '../store/session.js';

export async function renderLibrary() {
  const scripts = await listScripts();
  const resume = await resumable();

  return h(
    'main',
    { class: 'page' },
    h(
      'header',
      { class: 'masthead' },
      h('h1', { class: 'title' }, 'Prompt Book'),
      h('p', { class: 'subtitle' }, 'Rehearse your lines.'),
    ),
    resume && resumeCard(resume),
    scripts.length ? scriptList(scripts, resume) : emptyState(),
    h(
      'div',
      { class: 'actions' },
      h('a', { class: 'button primary', href: '#/import' }, 'Import a script'),
      h('a', { class: 'button', href: '#/settings' }, 'Settings'),
    ),
  );
}

/**
 * The last run, if it still points at something. Rehearsing the same scene ten
 * times in an evening used to mean walking the whole library every time.
 */
async function resumable() {
  const last = getLastRun();
  if (!last) return null;

  const loaded = await loadScript(last.scriptId);
  if (!loaded?.script.userCharacterId) {
    clearLastRun();
    return null;
  }
  return { ...last, script: loaded.script };
}

const resumeCard = ({ script, index, total, sceneTitle }) =>
  h(
    'a',
    { class: 'resume', href: `#/script/${script.id}/rehearse` },
    h('span', { class: 'resume-label' }, 'Carry on'),
    h('span', { class: 'resume-title' }, script.title),
    h(
      'span',
      { class: 'resume-meta' },
      [sceneTitle, index > 0 && total ? `line ${index + 1} of ${total}` : null]
        .filter(Boolean)
        .join(' · '),
    ),
  );

const emptyState = () =>
  h(
    'div',
    { class: 'empty' },
    h('p', null, 'No scripts yet.'),
    h(
      'p',
      { class: 'note' },
      'Prompt Book reads plain text and Fountain. Plain text needs only a name and a colon:',
    ),
    h(
      'pre',
      { class: 'sample' },
      'MIRA: Breathe. You have done harder things.\n\nDEV: Mira? We are ready for you.',
    ),
    h(
      'p',
      { class: 'note' },
      'Nothing is discarded without showing you first — you correct anything the parser guesses wrong before it is saved.',
    ),
  );

const scriptList = (scripts, resume) =>
  h(
    'ul',
    { class: 'script-list' },
    scripts.map((script) =>
      h(
        'li',
        null,
        h(
          'a',
          { class: 'script-card', href: `#/script/${script.id}` },
          h('span', { class: 'script-title' }, script.title),
          h('span', { class: 'script-meta' }, describe(script, resume)),
        ),
      ),
    ),
  );

/** The number an actor cares about is how many lines are theirs. */
function describe(script, resume) {
  const parts = [plural(script.sceneCount ?? 0, 'scene')];
  const mine = script.characters?.find((c) => c.id === script.userCharacterId);
  if (mine) parts.push(`you play ${mine.name}`);
  else parts.push(plural(script.characters?.length ?? 0, 'character'));
  if (resume?.script.id === script.id) parts.push('in progress');
  return parts.join(' · ');
}
