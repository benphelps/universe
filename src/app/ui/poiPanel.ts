import { seedToHex } from '../../core/rng/hash';
import { galaxySeed } from '../../universe/galaxy/galaxySeed';
import {
  SURVEY_MARKS,
  bookmarkKey,
  removeMark,
  savedMarks,
  setCaption,
  type Bookmark,
} from '../bookmarks';
import type { Sidebar } from './sidebar';

/**
 * The POI tab: the survey's shipped highlights up top, the traveler's
 * own marks below — every row a travel link, marks made in another
 * galaxy carrying it along. The catalog plate above stays on the
 * current body; this tab is the address book, not a camera level.
 */
export class PoiPanel {
  constructor(private readonly sidebar: Sidebar) {}

  render(onTravel: (mark: Bookmark) => void, onMutate: () => void): void {
    const here = seedToHex(galaxySeed());
    const saved = savedMarks();
    const rowsFor = (marks: Bookmark[], tag: string): string =>
      marks
        .map(
          (mark, i) => `<div class="mark pick" data-${tag}="${i}">
            <div class="mark-head">
              <span class="kind">${kindOf(mark)}</span> ${mark.name}
              ${mark.galaxy === here ? '' : '<span class="badge far">other galaxy</span>'}
              ${tag === 'mine' ? '<button class="unmark" title="remove this mark">×</button>' : ''}
            </div>
            ${
              tag === 'mine'
                ? `<div class="mark-note editable" title="click to edit the note">${mark.caption || '<span class="note-hint">add a note</span>'}</div>`
                : `<div class="mark-note">${mark.caption}</div>`
            }
          </div>`,
        )
        .join('');

    this.sidebar.level.innerHTML = `
      <h2>Survey highlights · ${SURVEY_MARKS.length}</h2>
      ${rowsFor(SURVEY_MARKS, 'poi')}
      <h2>Your marks · ${saved.length}</h2>
      ${
        saved.length > 0
          ? rowsFor(saved, 'mine')
          : '<div class="empty">nothing marked yet — the bookmark beside a body’s name saves it here</div>'
      }
    `;

    for (const row of this.sidebar.level.querySelectorAll<HTMLElement>('.mark.pick')) {
      row.addEventListener('click', () => {
        const { poi, mine } = row.dataset;
        onTravel(poi !== undefined ? SURVEY_MARKS[Number(poi)] : saved[Number(mine)]);
      });
    }
    for (const button of this.sidebar.level.querySelectorAll<HTMLElement>('button.unmark')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const row = button.closest('.mark') as HTMLElement;
        removeMark(bookmarkKey(saved[Number(row.dataset.mine)]));
        onMutate();
        this.render(onTravel, onMutate);
      });
    }
    for (const note of this.sidebar.level.querySelectorAll<HTMLElement>('.mark-note.editable')) {
      note.addEventListener('click', (event) => {
        event.stopPropagation();
        const row = note.closest('.mark') as HTMLElement;
        this.editNote(note, saved[Number(row.dataset.mine)], onTravel, onMutate);
      });
    }
  }

  /** Swap the note for an input in place: Enter or blur keeps, Escape doesn't. */
  private editNote(
    note: HTMLElement,
    mark: Bookmark,
    onTravel: (mark: Bookmark) => void,
    onMutate: () => void,
  ): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-edit';
    input.maxLength = 160;
    input.value = mark.caption;
    note.replaceChildren(input);
    input.focus();
    input.select();
    let settled = false;
    const finish = (keep: boolean): void => {
      if (settled) return;
      settled = true;
      if (keep) setCaption(bookmarkKey(mark), input.value.trim());
      this.render(onTravel, onMutate);
    };
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      else if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }
}

function kindOf(mark: Bookmark): string {
  if (mark.view !== 'planet') return mark.view;
  return mark.moon !== undefined ? 'moon' : 'planet';
}
