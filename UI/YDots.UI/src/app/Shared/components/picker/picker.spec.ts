import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PickerComponent, PickerOption } from './picker';

/**
 * The picker inside a container shaped like the department dialog: transformed, scrolling and clipped.
 * That is exactly where a position: fixed panel used to be captured and never appear.
 */
@Component({
  standalone: true,
  imports: [PickerComponent],
  template: `
    <div style="transform: translateY(0); overflow: hidden; max-height: 200px">
      <div class="scroller" style="overflow-y: auto; max-height: 200px">
        <app-picker [options]="options" [value]="value()" noneLabel="Top level"
                    searchPlaceholder="Search departments" (valueChange)="value.set($event)" />
      </div>
    </div>`,
})
class HostComponent {
  readonly options: PickerOption[] = [
    { value: 'd1', label: 'Finance', hint: 'FIN' },
    { value: 'd2', label: 'Fundraising', hint: 'FUN' },
    { value: 'd3', label: 'Technology', hint: 'TEC' },
  ];
  readonly value = signal('');
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const panel = () => document.body.querySelector<HTMLElement>(':scope > .pk-panel');
const labels = () => [...(panel()?.querySelectorAll('.pk-option-label') ?? [])].map((el) => el.textContent?.trim());

describe('PickerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let trigger: HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    trigger = fixture.nativeElement.querySelector('.pk-trigger');
  });

  afterEach(() => fixture.destroy());

  async function openIt(): Promise<void> {
    trigger.click();
    fixture.detectChanges();
    await tick();
    fixture.detectChanges();
  }

  it('shows the none label while nothing is chosen', () => {
    expect(trigger.textContent?.trim()).toBe('Top level');
  });

  it('opens its panel under <body>, out of the transformed dialog, with a search box and every option', async () => {
    await openIt();
    expect(panel()).not.toBeNull();
    expect(panel()!.querySelector('.pk-search input')).not.toBeNull();
    expect(labels()).toEqual(['Top level', 'Finance', 'Fundraising', 'Technology']);
  });

  it('stays open when the dialog scrolls because of the opening itself', async () => {
    await openIt();
    fixture.nativeElement.querySelector('.scroller').dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
    expect(panel()).not.toBeNull();
  });

  it('filters by the search text, matching labels and hints', async () => {
    await openIt();
    const search = panel()!.querySelector<HTMLInputElement>('.pk-search input')!;
    search.value = 'fun';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(labels()).toEqual(['Fundraising']);

    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(labels()).toEqual([]);
    expect(panel()!.querySelector('.pk-empty')?.textContent).toContain('No matches');
  });

  it('picks an option on click, closes, and shows the choice', async () => {
    await openIt();
    const technology = [...panel()!.querySelectorAll<HTMLButtonElement>('.pk-option')]
      .find((el) => el.textContent?.includes('Technology'))!;
    technology.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('d3');
    expect(panel()).toBeNull();
    expect(trigger.textContent?.trim()).toBe('Technology');
  });

  it('closes on a click outside, and on Escape without letting it reach the page', async () => {
    await openIt();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();
    expect(panel()).toBeNull();

    await openIt();
    let reachedDocument = false;
    const listener = () => (reachedDocument = true);
    document.addEventListener('keydown', listener);
    panel()!.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    document.removeEventListener('keydown', listener);
    expect(panel()).toBeNull();
    expect(reachedDocument).toBe(false);
  });

  it('picks with the keyboard: ArrowDown then Enter', async () => {
    await openIt();
    const search = panel()!.querySelector<HTMLInputElement>('.pk-search input')!;
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('d1');
  });

  it('removes its panel from <body> if destroyed while open', async () => {
    await openIt();
    fixture.destroy();
    expect(panel()).toBeNull();
  });
});
