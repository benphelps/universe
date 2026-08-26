/** The chart chip in the viewport's corner: sector borders on or off. */
export class ChartToggle {
  constructor(element: HTMLElement, onToggle: (visible: boolean) => void) {
    element.addEventListener('click', () => {
      const visible = !element.classList.contains('active');
      element.classList.toggle('active', visible);
      onToggle(visible);
    });
  }
}
