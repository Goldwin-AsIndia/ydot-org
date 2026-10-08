import { Component, DOCUMENT, effect, inject, OnInit, Renderer2, signal } from '@angular/core';
import { LayoutService } from '../../Service/layout-service';
import { ThemePicker } from '../components/theme-picker/theme-picker';
import { ThemeColorService } from './theme-color.service';
import { legacyPrimaryVars } from './theme-palette';

interface FontOption {
  name: string;
  value: string;
  /** Sans / Serif / Mono - the picker groups by it. */
  group: 'Sans' | 'Serif' | 'Mono';
  /** Shown with a "Premium" mark in the picker. */
  premium?: boolean;
}

/** The five type roles the customiser controls. Each writes one CSS variable that every screen reads. */
type FontRole = 'display' | 'heading' | 'other' | 'number' | 'menu';

interface FontPairing {
  name: string;
  note: string;
  display: string;
  heading: string;
  other: string;
  number: string;
  menu: string;
}

/** One number per type role (a size step or a weight step). */
type RoleLevels = Record<FontRole, number>;

interface RoleControl {
  key: FontRole;
  label: string;
  hint: string;
  sample: string;
  /** The size (px) and weight the role is designed at: what the live preview in the panel starts from. */
  size: number;
  weight: number;
}

interface RailSection {
  key: string;
  icon: string;
  label: string;
}

interface ThemeSettings {
  primaryColor: string;
  secondaryColor: string;
  iconColor: string;
  headingColor: string;
  isDarkMode: boolean;
  layoutMode: string;
  menuFont: string;
  displayFont: string;
  headingFont: string;
  numberFont: string;
  otherFont: string;
  /** Overall text size multiplier (1 = as designed). */
  textScale: number;
  /** Per-role size steps (SIZE_STEP each) and weight steps (WEIGHT_STEP each) on top of the overall setting. */
  sizeSteps: RoleLevels;
  weightSteps: RoleLevels;
  lineHeight: number;
  shadowStrength: number;
  borderRadius: number;
  buttonRadius: number;
  sidebarBg: string | null;
  profilePhoto: string | null;
  /** Precision type: one font stack applied to every role, without losing the per-role picks. */
  precisionFont: boolean;
  fontsV?: number;
  /** Text-size baseline: 2 = the panel's 100% is the 116% size (older saves were relative to the old base). */
  textScaleV?: number;
}

const STORAGE_KEY = 'app-theme-settings';
const FONTS_VERSION = 3;
const TEXT_SCALE_VERSION = 2;

/** One size step is 6% of the designed size; -4 is 76%, +6 is 136%. */
const SIZE_STEP = 0.06;
const SIZE_STEP_MIN = -4;
const SIZE_STEP_MAX = 6;
/** One weight step is one CSS weight (100); the result is held to 100-900 where the rules are written. */
const WEIGHT_STEP = 100;
const WEIGHT_STEP_MIN = -2;
const WEIGHT_STEP_MAX = 3;

/** The Precision stack: Manrope first (self-hosted), then system fallbacks. */
const PRECISION_STACK = 'Manrope, "Segoe UI", Arial, sans-serif';

const NO_STEPS: RoleLevels = { display: 0, heading: 0, other: 0, number: 0, menu: 0 };

/** Custom property suffix per role: --ts-<suffix> (size) and --fwb-<suffix> (weight step), see styles/ydot-typography.css. */
const ROLE_VAR: Record<FontRole, string> = { display: 'title', heading: 'heading', other: 'body', number: 'number', menu: 'menu' };

const DEFAULT_SETTINGS: ThemeSettings = {
  primaryColor: '#315746',
  secondaryColor: '#305faa',
  iconColor: '#64748b',
  headingColor: '#111827',
  isDarkMode: false,
  layoutMode: 'box',
  precisionFont: false,
  menuFont: 'Outfit, sans-serif',
  displayFont: 'Outfit, sans-serif',
  headingFont: 'Outfit, sans-serif',
  numberFont: 'Outfit, sans-serif',
  otherFont: 'Outfit, sans-serif',
  textScale: 1,
  textScaleV: TEXT_SCALE_VERSION,
  sizeSteps: NO_STEPS,
  weightSteps: NO_STEPS,
  lineHeight: 1.6,
  shadowStrength: 15,
  borderRadius: 8,
  buttonRadius: 8,
  sidebarBg: null,
  profilePhoto: null,
};

@Component({
  selector: 'app-theme',
  standalone: true,
  imports: [ThemePicker],
  templateUrl: './theme.html',
  styleUrl: './theme.css',
})
export class ThemeComponent implements OnInit {
  private layoutService = inject(LayoutService);
  private renderer = inject(Renderer2);
  private document = inject(DOCUMENT);
  private themeColorService = inject(ThemeColorService);

  constructor() {
    // The Primary color section is now the shared ThemePicker, which writes to ThemeColorService. Keep the
    // customizer's own primary variables (--primary, --pe-primary…, which the existing buttons and links
    // read) following the same single colour.
    effect(() => {
      const color = this.themeColorService.themeColor();
      if (color !== this.settings.primaryColor) this.applyPrimaryColor(color);
    });
  }

  // ── Panel open / active rail section come from the shared LayoutService ──
  get isOpen(): boolean {
    return this.layoutService.themePanelOpen;
  }

  get activeSection(): string {
    return this.layoutService.activeThemeSection;
  }
  set activeSection(value: string) {
    this.layoutService.activeThemeSection = value;
  }

  readonly sections: RailSection[] = [
    { key: 'colors',     icon: 'bi bi-palette2',      label: 'Primary color' },
    { key: 'secondary',  icon: 'bi bi-droplet-half',  label: 'Secondary color' },
    { key: 'mode',       icon: 'bi bi-circle-half',   label: 'Mode' },
    { key: 'layout',     icon: 'bi bi-layout-split',  label: 'Layout' },
    { key: 'fontFamily', icon: 'bi bi-fonts',         label: 'Font family' },
    { key: 'fontStyle',  icon: 'bi bi-type',          label: 'Font size & style' },
    { key: 'appearance', icon: 'bi bi-shadows',       label: 'Shadow & radius' },
    { key: 'icon',       icon: 'bi bi-stars',         label: 'Icon color' },
    { key: 'heading',    icon: 'bi bi-type-h1',       label: 'Heading color' },
    { key: 'background', icon: 'bi bi-image',         label: 'Sidebar background' },
    { key: 'profile',    icon: 'bi bi-person-circle', label: 'Profile photo' },
  ];

  setActive(key: string): void {
    this.activeSection = key;
  }

  openPanel(): void {
    this.layoutService.openThemePanel();
  }

  closePanel(): void {
    this.layoutService.closeThemePanel();
  }

  // ── Toast ──
  toast: { type: 'success' | 'error'; message: string } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast = { type, message };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), 3000);
  }

  // ── Live state ──
  settings: ThemeSettings = { ...DEFAULT_SETTINGS };

  // Convenience getters/setters used by the template (kept flat to match markup)
  get primaryColor()   { return this.settings.primaryColor; }
  get secondaryColor() { return this.settings.secondaryColor; }
  get iconColor()       { return this.settings.iconColor; }
  get headingColor()    { return this.settings.headingColor; }
  get isDarkMode()      { return this.settings.isDarkMode; }
  get layoutMode()      { return this.settings.layoutMode; }
  get selectedMenuFont()    { return this.settings.menuFont; }
  get selectedDisplayFont() { return this.settings.displayFont; }
  get selectedHeadingFont() { return this.settings.headingFont; }
  get selectedNumberFont()  { return this.settings.numberFont; }
  get selectedOtherFont()   { return this.settings.otherFont; }
  get selectedTextScale()   { return this.settings.textScale; }
  get selectedLineHeight()  { return this.settings.lineHeight; }
  get shadowLevel()         { return this.settings.shadowStrength; }
  get borderRadiusLevel()   { return this.settings.borderRadius; }
  get buttonRadiusLevel()   { return this.settings.buttonRadius; }
  get selectedBg()           { return this.settings.sidebarBg; }
  get selectedProfilePhoto() { return this.settings.profilePhoto; }

  // ── Presets ──
  readonly defaultSecondaryPresets = ['#fa896b', '#305faa', '#31f3c2', '#9ac500', '#bd0068', '#00bebe'];
  readonly defaultIconPresets      = ['#64748b', '#f97316', '#ef4444', '#8b5cf6', '#10b981', '#fb3cf9'];
  readonly defaultHeadingPresets   = ['#00af43', '#ff27a5', '#c2a500', '#b8530b', '#ef4444', '#8b5cf6'];

  secondaryPresets: string[] = [];
  iconPresets:      string[] = [];
  headingPresets:   string[] = [];

  // ── Fonts ──
  readonly fonts: FontOption[] = [
    // Sans
    { name: 'Outfit',            value: 'Outfit, sans-serif',                   group: 'Sans' },
    { name: 'Inter',             value: 'Inter, sans-serif',                    group: 'Sans' },
    { name: 'Quicksand',         value: 'Quicksand, sans-serif',                group: 'Sans' },
    { name: 'Plus Jakarta Sans', value: "'Plus Jakarta Sans', sans-serif",      group: 'Sans', premium: true },
    { name: 'Manrope',           value: 'Manrope, sans-serif',                  group: 'Sans', premium: true },
    { name: 'DM Sans',           value: "'DM Sans', sans-serif",                group: 'Sans', premium: true },
    { name: 'Sora',              value: 'Sora, sans-serif',                     group: 'Sans', premium: true },
    { name: 'Urbanist',          value: 'Urbanist, sans-serif',                 group: 'Sans', premium: true },
    { name: 'Figtree',           value: 'Figtree, sans-serif',                  group: 'Sans', premium: true },
    { name: 'Lexend',            value: 'Lexend, sans-serif',                   group: 'Sans', premium: true },
    { name: 'Space Grotesk',     value: "'Space Grotesk', sans-serif",          group: 'Sans', premium: true },
    { name: 'Syne',              value: 'Syne, sans-serif',                     group: 'Sans', premium: true },
    { name: 'IBM Plex Sans',     value: "'IBM Plex Sans', sans-serif",          group: 'Sans' },
    { name: 'Onest',             value: 'Onest, sans-serif',                    group: 'Sans', premium: true },
    { name: 'Hanken Grotesk',    value: "'Hanken Grotesk', sans-serif",         group: 'Sans', premium: true },
    { name: 'Instrument Sans',   value: "'Instrument Sans', sans-serif",        group: 'Sans', premium: true },
    { name: 'Albert Sans',       value: "'Albert Sans', sans-serif",            group: 'Sans', premium: true },
    { name: 'Red Hat Display',   value: "'Red Hat Display', sans-serif",        group: 'Sans', premium: true },
    { name: 'Bricolage',         value: "'Bricolage Grotesque', sans-serif",    group: 'Sans', premium: true },
    { name: 'Be Vietnam Pro',    value: "'Be Vietnam Pro', sans-serif",         group: 'Sans', premium: true },
    { name: 'Geist',             value: 'Geist, sans-serif',                    group: 'Sans', premium: true },
    { name: 'Work Sans',         value: "'Work Sans', sans-serif",              group: 'Sans', premium: true },
    { name: 'Public Sans',       value: "'Public Sans', sans-serif",            group: 'Sans', premium: true },
    { name: 'Poppins',           value: 'Poppins, sans-serif',                  group: 'Sans' },
    { name: 'Montserrat',        value: 'Montserrat, sans-serif',               group: 'Sans' },
    { name: 'Roboto',            value: 'Roboto, sans-serif',                   group: 'Sans' },
    { name: 'Open Sans',         value: "'Open Sans', sans-serif",              group: 'Sans' },
    { name: 'Lato',              value: 'Lato, sans-serif',                     group: 'Sans' },
    { name: 'Nunito',            value: 'Nunito, sans-serif',                   group: 'Sans' },
    { name: 'Raleway',           value: 'Raleway, sans-serif',                  group: 'Sans' },
    // Serif
    { name: 'Playfair Display',  value: "'Playfair Display', Georgia, serif",   group: 'Serif' },
    { name: 'Cormorant',         value: "'Cormorant Garamond', Georgia, serif", group: 'Serif', premium: true },
    { name: 'Fraunces',          value: 'Fraunces, Georgia, serif',             group: 'Serif', premium: true },
    { name: 'Bodoni Moda',       value: "'Bodoni Moda', Georgia, serif",        group: 'Serif', premium: true },
    { name: 'DM Serif Display',  value: "'DM Serif Display', Georgia, serif",   group: 'Serif', premium: true },
    { name: 'Instrument Serif',  value: "'Instrument Serif', Georgia, serif",   group: 'Serif', premium: true },
    { name: 'Cinzel',            value: 'Cinzel, Georgia, serif',               group: 'Serif', premium: true },
    { name: 'EB Garamond',       value: "'EB Garamond', Georgia, serif",        group: 'Serif', premium: true },
    { name: 'Libre Baskerville', value: "'Libre Baskerville', Georgia, serif",  group: 'Serif', premium: true },
    { name: 'Newsreader',        value: 'Newsreader, Georgia, serif',           group: 'Serif', premium: true },
    { name: 'Spectral',          value: 'Spectral, Georgia, serif',             group: 'Serif', premium: true },
    { name: 'Literata',          value: 'Literata, Georgia, serif',             group: 'Serif', premium: true },
    { name: 'Crimson Pro',       value: "'Crimson Pro', Georgia, serif",        group: 'Serif', premium: true },
    { name: 'Noto Serif Display', value: "'Noto Serif Display', Georgia, serif", group: 'Serif', premium: true },
    { name: 'Bitter',            value: 'Bitter, Georgia, serif',               group: 'Serif', premium: true },
    { name: 'Lora',              value: 'Lora, Georgia, serif',                 group: 'Serif' },
    { name: 'Source Serif',      value: "'Source Serif 4', Georgia, serif",     group: 'Serif' },
    { name: 'Georgia',           value: 'Georgia, serif',                       group: 'Serif' },
    // Mono
    { name: 'IBM Plex Mono',     value: "'IBM Plex Mono', monospace",           group: 'Mono' },
    { name: 'JetBrains Mono',    value: "'JetBrains Mono', monospace",          group: 'Mono', premium: true },
    { name: 'Space Mono',        value: "'Space Mono', monospace",              group: 'Mono', premium: true },
    { name: 'Geist Mono',        value: "'Geist Mono', monospace",              group: 'Mono', premium: true },
    { name: 'DM Mono',           value: "'DM Mono', monospace",                 group: 'Mono', premium: true },
    { name: 'Courier',           value: 'Courier New, monospace',               group: 'Mono' },
  ];

  readonly fontGroups: FontOption['group'][] = ['Sans', 'Serif', 'Mono'];
  fontsIn(group: FontOption['group']): FontOption[] {
    return this.fonts.filter(f => f.group === group);
  }

  /** The five roles, in the order the panel lists them. */
  readonly fontRoles: { key: FontRole; label: string; hint: string; sample: string }[] = [
    { key: 'display', label: 'Title font',   hint: 'Page, card and dialog titles', sample: 'Hope Foundation' },
    { key: 'heading', label: 'Heading font', hint: 'Sub-headings, labels, pills',  sample: 'Campaign overview' },
    { key: 'other',   label: 'Body font',    hint: 'Paragraphs, tables, fields',   sample: 'Every gift changes a life.' },
    { key: 'number',  label: 'Number font',  hint: 'Amounts, counts, codes',       sample: '12,48,560' },
    { key: 'menu',    label: 'Menu font',    hint: 'Sidebar navigation',           sample: 'Campaigns · Donors' },
  ];

  /** One-click premium pairings: every role at once. */
  readonly fontPairings: FontPairing[] = [
    { name: 'Signature', note: 'Playfair · Outfit',
      display: "'Playfair Display', Georgia, serif", heading: 'Outfit, sans-serif', other: 'Outfit, sans-serif', number: 'Outfit, sans-serif', menu: 'Outfit, sans-serif' },
    { name: 'Couture', note: 'Bodoni · Figtree',
      display: "'Bodoni Moda', Georgia, serif", heading: 'Figtree, sans-serif', other: 'Figtree, sans-serif', number: 'Figtree, sans-serif', menu: 'Figtree, sans-serif' },
    { name: 'Heritage', note: 'Cormorant · Manrope',
      display: "'Cormorant Garamond', Georgia, serif", heading: 'Manrope, sans-serif', other: 'Manrope, sans-serif', number: 'Manrope, sans-serif', menu: 'Manrope, sans-serif' },
    { name: 'Editorial', note: 'Fraunces · Inter',
      display: 'Fraunces, Georgia, serif', heading: 'Inter, sans-serif', other: 'Inter, sans-serif', number: "'IBM Plex Mono', monospace", menu: 'Inter, sans-serif' },
    { name: 'Gallery', note: 'DM Serif · DM Sans',
      display: "'DM Serif Display', Georgia, serif", heading: "'DM Sans', sans-serif", other: "'DM Sans', sans-serif", number: "'DM Sans', sans-serif", menu: "'DM Sans', sans-serif" },
    { name: 'Modern', note: 'Sora · Plus Jakarta',
      display: 'Sora, sans-serif', heading: "'Plus Jakarta Sans', sans-serif", other: "'Plus Jakarta Sans', sans-serif", number: 'Sora, sans-serif', menu: "'Plus Jakarta Sans', sans-serif" },
    { name: 'Studio', note: 'Space Grotesk · JetBrains',
      display: "'Space Grotesk', sans-serif", heading: "'Space Grotesk', sans-serif", other: 'Inter, sans-serif', number: "'JetBrains Mono', monospace", menu: 'Inter, sans-serif' },
    { name: 'Royal', note: 'Cinzel · Lato',
      display: 'Cinzel, Georgia, serif', heading: 'Lato, sans-serif', other: 'Lato, sans-serif', number: 'Lato, sans-serif', menu: 'Lato, sans-serif' },
    { name: 'Maison', note: 'Cormorant · Outfit',
      display: "'Cormorant Garamond', Georgia, serif", heading: 'Outfit, sans-serif', other: 'Outfit, sans-serif', number: 'Outfit, sans-serif', menu: 'Outfit, sans-serif' },
    { name: 'Atelier', note: 'Playfair · Inter',
      display: "'Playfair Display', Georgia, serif", heading: 'Inter, sans-serif', other: 'Inter, sans-serif', number: 'Inter, sans-serif', menu: 'Inter, sans-serif' },
    { name: 'Boutique', note: 'Libre Baskerville · DM Sans',
      display: "'Libre Baskerville', Georgia, serif", heading: "'DM Sans', sans-serif", other: "'DM Sans', sans-serif", number: "'DM Sans', sans-serif", menu: "'DM Sans', sans-serif" },
    { name: 'Penthouse', note: 'Instrument Serif · Figtree',
      display: "'Instrument Serif', Georgia, serif", heading: 'Figtree, sans-serif', other: 'Figtree, sans-serif', number: 'Figtree, sans-serif', menu: 'Figtree, sans-serif' },
    { name: 'Chancery', note: 'EB Garamond · Lato',
      display: "'EB Garamond', Georgia, serif", heading: 'Lato, sans-serif', other: 'Lato, sans-serif', number: 'Lato, sans-serif', menu: 'Lato, sans-serif' },
    { name: 'Salon', note: 'Lora · Plus Jakarta',
      display: 'Lora, Georgia, serif', heading: "'Plus Jakarta Sans', sans-serif", other: "'Plus Jakarta Sans', sans-serif", number: "'Plus Jakarta Sans', sans-serif", menu: "'Plus Jakarta Sans', sans-serif" },
    { name: 'Broadsheet', note: 'Source Serif · Inter',
      display: "'Source Serif 4', Georgia, serif", heading: 'Inter, sans-serif', other: 'Inter, sans-serif', number: "'IBM Plex Mono', monospace", menu: 'Inter, sans-serif' },
    { name: 'Aurora', note: 'Urbanist · Urbanist',
      display: 'Urbanist, sans-serif', heading: 'Urbanist, sans-serif', other: 'Urbanist, sans-serif', number: 'Urbanist, sans-serif', menu: 'Urbanist, sans-serif' },
    { name: 'Lumen', note: 'Lexend · Manrope',
      display: 'Lexend, sans-serif', heading: 'Manrope, sans-serif', other: 'Manrope, sans-serif', number: 'Manrope, sans-serif', menu: 'Manrope, sans-serif' },
    { name: 'Nocturne', note: 'Fraunces · Outfit',
      display: 'Fraunces, Georgia, serif', heading: 'Outfit, sans-serif', other: 'Outfit, sans-serif', number: 'Outfit, sans-serif', menu: 'Outfit, sans-serif' },
    { name: 'Vellum', note: 'Bodoni · Raleway',
      display: "'Bodoni Moda', Georgia, serif", heading: 'Raleway, sans-serif', other: 'Raleway, sans-serif', number: 'Raleway, sans-serif', menu: 'Raleway, sans-serif' },
    { name: 'Monogram', note: 'Montserrat · Montserrat',
      display: 'Montserrat, sans-serif', heading: 'Montserrat, sans-serif', other: 'Montserrat, sans-serif', number: 'Montserrat, sans-serif', menu: 'Montserrat, sans-serif' },
    { name: 'Obsidian', note: 'Newsreader · Geist',
      display: 'Newsreader, Georgia, serif', heading: 'Geist, sans-serif', other: 'Geist, sans-serif', number: "'Geist Mono', monospace", menu: 'Geist, sans-serif' },
    { name: 'Meridian', note: 'Bricolage · Hanken',
      display: "'Bricolage Grotesque', sans-serif", heading: "'Hanken Grotesk', sans-serif", other: "'Hanken Grotesk', sans-serif", number: "'Hanken Grotesk', sans-serif", menu: "'Hanken Grotesk', sans-serif" },
    { name: 'Quartz', note: 'Instrument Sans · Geist Mono',
      display: "'Instrument Sans', sans-serif", heading: "'Instrument Sans', sans-serif", other: "'Instrument Sans', sans-serif", number: "'Geist Mono', monospace", menu: "'Instrument Sans', sans-serif" },
    { name: 'Sterling', note: 'Noto Serif · Albert',
      display: "'Noto Serif Display', Georgia, serif", heading: "'Albert Sans', sans-serif", other: "'Albert Sans', sans-serif", number: "'Albert Sans', sans-serif", menu: "'Albert Sans', sans-serif" },
    { name: 'Velvet', note: 'Crimson Pro · Onest',
      display: "'Crimson Pro', Georgia, serif", heading: 'Onest, sans-serif', other: 'Onest, sans-serif', number: 'Onest, sans-serif', menu: 'Onest, sans-serif' },
    { name: 'Orchid', note: 'Literata · Be Vietnam',
      display: 'Literata, Georgia, serif', heading: "'Be Vietnam Pro', sans-serif", other: "'Be Vietnam Pro', sans-serif", number: "'Be Vietnam Pro', sans-serif", menu: "'Be Vietnam Pro', sans-serif" },
    { name: 'Ember', note: 'Red Hat Display · Public',
      display: "'Red Hat Display', sans-serif", heading: "'Public Sans', sans-serif", other: "'Public Sans', sans-serif", number: "'Public Sans', sans-serif", menu: "'Public Sans', sans-serif" },
    { name: 'Ivory', note: 'Spectral · Work Sans',
      display: 'Spectral, Georgia, serif', heading: "'Work Sans', sans-serif", other: "'Work Sans', sans-serif", number: "'Work Sans', sans-serif", menu: "'Work Sans', sans-serif" },
    { name: 'Slate', note: 'Geist · Geist Mono',
      display: 'Geist, sans-serif', heading: 'Geist, sans-serif', other: 'Geist, sans-serif', number: "'Geist Mono', monospace", menu: 'Geist, sans-serif' },
    { name: 'Sable', note: 'Bitter · Hanken',
      display: 'Bitter, Georgia, serif', heading: "'Hanken Grotesk', sans-serif", other: "'Hanken Grotesk', sans-serif", number: "'Hanken Grotesk', sans-serif", menu: "'Hanken Grotesk', sans-serif" },
    { name: 'Nordic', note: 'Onest · Onest',
      display: 'Onest, sans-serif', heading: 'Onest, sans-serif', other: 'Onest, sans-serif', number: 'Onest, sans-serif', menu: 'Onest, sans-serif' },
    { name: 'Opal', note: 'Albert Sans · DM Mono',
      display: "'Albert Sans', sans-serif", heading: "'Albert Sans', sans-serif", other: "'Albert Sans', sans-serif", number: "'DM Mono', monospace", menu: "'Albert Sans', sans-serif" },
    { name: 'Regent', note: 'Newsreader · Manrope',
      display: 'Newsreader, Georgia, serif', heading: 'Manrope, sans-serif', other: 'Manrope, sans-serif', number: 'Manrope, sans-serif', menu: 'Manrope, sans-serif' },
    { name: 'Parchment', note: 'Crimson Pro · Lato',
      display: "'Crimson Pro', Georgia, serif", heading: 'Lato, sans-serif', other: 'Lato, sans-serif', number: 'Lato, sans-serif', menu: 'Lato, sans-serif' },
    { name: 'Vanguard', note: 'Bricolage · Inter',
      display: "'Bricolage Grotesque', sans-serif", heading: 'Inter, sans-serif', other: 'Inter, sans-serif', number: "'DM Mono', monospace", menu: 'Inter, sans-serif' },
    { name: 'Cascade', note: 'Red Hat Display · DM Sans',
      display: "'Red Hat Display', sans-serif", heading: "'DM Sans', sans-serif", other: "'DM Sans', sans-serif", number: "'DM Sans', sans-serif", menu: "'DM Sans', sans-serif" },
    { name: 'Lyceum', note: 'Literata · Inter',
      display: 'Literata, Georgia, serif', heading: 'Inter, sans-serif', other: 'Inter, sans-serif', number: 'Inter, sans-serif', menu: 'Inter, sans-serif' },
    { name: 'Mercer', note: 'Noto Serif · Inter',
      display: "'Noto Serif Display', Georgia, serif", heading: 'Inter, sans-serif', other: 'Inter, sans-serif', number: 'Inter, sans-serif', menu: 'Inter, sans-serif' },
  ];

  /** Which role's font list is unfolded in the panel (one at a time). */
  readonly openFontRole = signal<FontRole | null>(null);
  toggleFontRole(role: FontRole): void {
    this.openFontRole.update(r => (r === role ? null : role));
  }

  readonly precisionStack = PRECISION_STACK;
  get precisionOn(): boolean { return this.settings.precisionFont; }

  setPrecision(on: boolean): void {
    this.settings.precisionFont = on;
    this.applyFontVars();
  }

  fontFor(role: FontRole): string {
    if (this.settings.precisionFont) return PRECISION_STACK;
    switch (role) {
      case 'display': return this.settings.displayFont;
      case 'heading': return this.settings.headingFont;
      case 'number':  return this.settings.numberFont;
      case 'menu':    return this.settings.menuFont;
      default:        return this.settings.otherFont;
    }
  }

  fontName(value: string): string {
    return this.fonts.find(f => f.value === value)?.name ?? value.split(',')[0].replace(/['"]/g, '');
  }

  isPairingActive(p: FontPairing): boolean {
    return !this.settings.precisionFont && p.display === this.settings.displayFont && p.heading === this.settings.headingFont &&
      p.other === this.settings.otherFont && p.number === this.settings.numberFont && p.menu === this.settings.menuFont;
  }

  applyPairing(p: FontPairing): void {
    this.setFont('display', p.display);
    this.setFont('heading', p.heading);
    this.setFont('other', p.other);
    this.setFont('number', p.number);
    this.setFont('menu', p.menu);
  }

  // ═══════════ Text size & weight ═══════════

  /** Overall size: scales every piece of text in the app, spacing untouched. */
  readonly textScales: { label: string; value: number }[] = [
    { label: 'Compact', value: 0.88 },
    { label: 'Small',   value: 0.94 },
    { label: 'Default', value: 1 },
    { label: 'Large',   value: 1.08 },
    { label: 'Larger',  value: 1.16 },
    { label: 'Largest', value: 1.28 },
  ];

  /** Overall weight: moves every role the same number of steps. */
  readonly weightPresets: { label: string; step: number }[] = [
    { label: 'Lighter',     step: -1 },
    { label: 'As designed', step: 0 },
    { label: 'Heavier',     step: 1 },
    { label: 'Bold',        step: 2 },
    { label: 'Extra bold',  step: 3 },
  ];

  /** The places size and weight can be set separately, with the size and weight each one is designed at. */
  readonly typeRoles: RoleControl[] = [
    { key: 'display', label: 'Titles',            hint: 'Page, card and dialog titles',      sample: 'Hope Foundation',            size: 22, weight: 600 },
    { key: 'heading', label: 'Headings & labels', hint: 'Sub-headings, field labels, pills', sample: 'Campaign overview',          size: 14, weight: 600 },
    { key: 'other',   label: 'Body text',         hint: 'Paragraphs, tables, form fields',   sample: 'Every gift changes a life.', size: 13, weight: 400 },
    { key: 'number',  label: 'Numbers',           hint: 'Amounts, counts, codes',            sample: '12,48,560',                  size: 24, weight: 600 },
    { key: 'menu',    label: 'Menu',              hint: 'Sidebar navigation',                sample: 'Campaigns · Donors',         size: 13, weight: 500 },
  ];

  readonly sizeStepMin = SIZE_STEP_MIN;
  readonly sizeStepMax = SIZE_STEP_MAX;
  readonly weightStepMin = WEIGHT_STEP_MIN;
  readonly weightStepMax = WEIGHT_STEP_MAX;

  sizeStep(role: FontRole): number {
    return this.settings.sizeSteps[role];
  }

  weightStep(role: FontRole): number {
    return this.settings.weightSteps[role];
  }

  /** "Default", "+12%" or "-6%": the role's size against the overall setting. */
  sizeLabel(role: FontRole): string {
    const step = this.sizeStep(role);
    if (step === 0) return 'Default';
    const pct = Math.round(step * SIZE_STEP * 100);
    return `${pct > 0 ? '+' : '-'}${Math.abs(pct)}%`;
  }

  /** "As designed", "Heavier +1" or "Lighter -2". */
  weightLabel(role: FontRole): string {
    const step = this.weightStep(role);
    if (step === 0) return 'As designed';
    return `${step > 0 ? 'Heavier +' : 'Lighter -'}${Math.abs(step)}`;
  }

  /** Size the panel previews for the role (px): designed size x overall x the role's own steps. */
  previewSize(control: RoleControl): number {
    return Math.round(control.size * this.settings.textScale * this.roleScale(control.key) * 10) / 10;
  }

  previewWeight(control: RoleControl): number {
    return Math.min(900, Math.max(100, control.weight + this.weightStep(control.key) * WEIGHT_STEP));
  }

  private roleScale(role: FontRole): number {
    return Math.round((1 + this.sizeStep(role) * SIZE_STEP) * 1000) / 1000;
  }

  setTextScale(value: number): void {
    this.settings.textScale = value;
    this.applyTypographyVars();
  }

  stepSize(role: FontRole, delta: number): void {
    const next = Math.min(SIZE_STEP_MAX, Math.max(SIZE_STEP_MIN, this.sizeStep(role) + delta));
    this.settings.sizeSteps = { ...this.settings.sizeSteps, [role]: next };
    this.applyTypographyVars();
  }

  stepWeight(role: FontRole, delta: number): void {
    const next = Math.min(WEIGHT_STEP_MAX, Math.max(WEIGHT_STEP_MIN, this.weightStep(role) + delta));
    this.settings.weightSteps = { ...this.settings.weightSteps, [role]: next };
    this.applyTypographyVars();
  }

  setAllWeights(step: number): void {
    this.settings.weightSteps = { display: step, heading: step, other: step, number: step, menu: step };
    this.applyTypographyVars();
  }

  isAllWeights(step: number): boolean {
    return (Object.values(this.settings.weightSteps) as number[]).every(v => v === step);
  }

  /** Back to the designed sizes and weights; typefaces are left alone. */
  resetTypography(): void {
    this.settings.textScale = 1;
    this.settings.sizeSteps = { ...NO_STEPS };
    this.settings.weightSteps = { ...NO_STEPS };
    this.applyTypographyVars();
  }

  /**
   * Writes the size and weight variables every stylesheet reads (styles/ydot-typography.css): one overall
   * multiplier, then a size multiplier and a weight step per role.
   */
  private applyTypographyVars(): void {
    const s = this.settings;
    this.setCssVar('--ts-global', String(s.textScale));
    for (const role of Object.keys(ROLE_VAR) as FontRole[]) {
      this.setCssVar(`--ts-${ROLE_VAR[role]}`, String(this.roleScale(role)));
      this.setCssVar(`--fwb-${ROLE_VAR[role]}`, String(s.weightSteps[role] * WEIGHT_STEP));
    }
  }

  // ── Sidebar Backgrounds & Avatars ──
  readonly backgrounds: string[] = [
    'https://picsum.photos/seed/sidebar-slate/400/400?blur=1',
    'https://picsum.photos/seed/sidebar-marble/400/400?blur=1',
    'https://picsum.photos/seed/sidebar-gradient/400/400?blur=1',
    'https://picsum.photos/seed/sidebar-charcoal/400/400?grayscale&blur=1',
    'https://picsum.photos/seed/sidebar-ocean/400/400?blur=1',
    'https://picsum.photos/seed/sidebar-dusk/400/400?blur=1',
  ];

  readonly profileImages: string[] = Array.from(
    { length: 10 },
    (_, i) => `https://picsum.photos/seed/user${i + 1}/100/100`
  );

  ngOnInit(): void {
    this.secondaryPresets = [...this.defaultSecondaryPresets, ...this.loadCustomColors('custom-secondary-colors', this.defaultSecondaryPresets)];
    this.iconPresets      = [...this.defaultIconPresets,      ...this.loadCustomColors('custom-icon-colors',      this.defaultIconPresets)];
    this.headingPresets   = [...this.defaultHeadingPresets,   ...this.loadCustomColors('custom-heading-colors',   this.defaultHeadingPresets)];

    this.loadTheme();

    // If the rail hasn't been pointed at one of this panel's sections yet, default to the first one
    if (!this.sections.some(s => s.key === this.activeSection)) {
      this.activeSection = 'colors';
    }
  }

  // ═══════════ Color helpers ═══════════

  private hexToRgb(hex: string): string {
    const clean = hex.replace('#', '');
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r}, ${g}, ${b}`;
  }

  private isValidHex(value: string): boolean {
    return /^#([0-9A-Fa-f]{6})$/.test(value);
  }

  /**
   * White is refused: it would vanish on the white page. That holds in dark mode too, because dark mode is the
   * light page inverted as a whole (styles/ydot-dark.css), so a colour is always judged against the light page.
   */
  private isColorAllowed(value: string): boolean {
    return this.isValidHex(value) && value.toLowerCase() !== '#ffffff';
  }

  private colorErrorMessage(color: string): string {
    if (!this.isValidHex(color)) return 'Invalid color format.';
    return 'White cannot be used: it would disappear on the page.';
  }

  private setCssVar(name: string, value: string): void {
    this.renderer.setStyle(this.document.documentElement, name, value, 2 /* DashCase, no important */);
    this.autoPersist();
  }

  // ═══════════ Primary color ═══════════

  private applyPrimaryColor(color: string): void {
    const lower = color.toLowerCase();
    if (!this.isColorAllowed(lower)) {
      this.showToast('error', this.colorErrorMessage(lower));
      return;
    }
    this.settings.primaryColor = lower;
    // ThemeColorService.apply() has already written the Bootstrap-era primary variables (the same
    // legacyPrimaryVars map) for this colour, and the sidebar background does not depend on it, so nothing is
    // rewritten here. Re-applying them made every colour change repeat ~10 style writes, ~10 storage writes and
    // a sidebar DOM update, which is what made dragging in the colour picker stutter.
    this.autoPersist();
  }

  /** Bootstrap's primary variables: the shared map, see legacyPrimaryVars(). */
  private applyLegacyPrimary(picked: string): void {
    for (const [name, value] of Object.entries(legacyPrimaryVars(picked))) {
      this.setCssVar(name, value);
    }
  }

  // ═══════════ Secondary color ═══════════

  setSecondaryPreset(color: string): void {
    this.applySecondaryColor(color);
  }

  onSecondaryInput(event: Event): void {
    this.applySecondaryColor((event.target as HTMLInputElement).value);
  }

  private applySecondaryColor(color: string): void {
    const lower = color.toLowerCase();
    if (!this.isColorAllowed(lower)) {
      this.showToast('error', this.colorErrorMessage(lower));
      return;
    }
    this.settings.secondaryColor = lower;
    this.setCssVar('--secondary', lower);
    // Apply globally to the app theme (pe-* variables used by app.min.css)
    this.setCssVar('--pe-secondary', lower);
    this.setCssVar('--pe-secondary-rgb', this.hexToRgb(lower));
    this.setCssVar('--pe-secondary-text-emphasis', lower);
    this.setCssVar('--pe-secondary-bg-subtle', `rgba(${this.hexToRgb(lower)}, 0.1)`);
    this.setCssVar('--pe-secondary-border-subtle', `rgba(${this.hexToRgb(lower)}, 0.5)`);
    this.setCssVar('--pe-secondary-color', lower);
  }

  get isCustomSecondary(): boolean {
    return !!this.secondaryColor &&
      !this.secondaryPresets.map(c => c.toLowerCase()).includes(this.secondaryColor.toLowerCase());
  }

  // ═══════════ Icon color ═══════════

  setIconPreset(color: string): void {
    this.applyIconColor(color);
  }

  onIconInput(event: Event): void {
    this.applyIconColor((event.target as HTMLInputElement).value);
  }

  private applyIconColor(color: string): void {
    const lower = color.toLowerCase();
    if (!this.isColorAllowed(lower)) {
      this.showToast('error', this.colorErrorMessage(lower));
      return;
    }
    this.settings.iconColor = lower;
    this.setCssVar('--icon-color', lower);
  }

  get isCustomIcon(): boolean {
    return !!this.iconColor &&
      !this.iconPresets.map(c => c.toLowerCase()).includes(this.iconColor.toLowerCase());
  }

  // ═══════════ Heading color ═══════════

  setHeadingPreset(color: string): void {
    this.applyHeadingColor(color);
  }

  onHeadingInput(event: Event): void {
    this.applyHeadingColor((event.target as HTMLInputElement).value);
  }

  private applyHeadingColor(color: string): void {
    const lower = color.toLowerCase();
    if (!this.isColorAllowed(lower)) {
      this.showToast('error', this.colorErrorMessage(lower));
      return;
    }
    this.settings.headingColor = lower;
    this.setCssVar('--heading-color', lower);
  }

  get isCustomHeading(): boolean {
    return !!this.headingColor &&
      !this.headingPresets.map(c => c.toLowerCase()).includes(this.headingColor.toLowerCase());
  }

  // ═══════════ Theme mode ═══════════

  setThemeMode(dark: boolean): void {
    this.settings.isDarkMode = dark;
    this.applyMode(dark);
    this.autoPersist();
  }

  /**
   * Dark and light are one attribute on <html> (styles/ydot-dark.css repaints the whole app from it, and the
   * blocking script in index.html sets it before first paint). Bootstrap's own data-bs-theme is held on
   * "light" in both modes so its partial dark variant never competes with it.
   */
  private applyMode(dark: boolean): void {
    const html = this.document.documentElement;
    if (dark) html.setAttribute('data-ydot-mode', 'dark');
    else html.removeAttribute('data-ydot-mode');
    this.layoutService.setAndSaveAttribute('data-bs-theme', 'light', false);
    this.layoutService.setTheme('light');
  }

  // ═══════════ Layout ═══════════

  selectLayout(mode: 'horizontal' | 'vertical'): void {
    this.settings.layoutMode = mode === 'horizontal' ? 'fluid' : 'box';
    this.layoutService.setAndSaveAttribute('data-layout', mode);
    if (mode === 'horizontal') {
      this.layoutService.removeHorizontalAttributes();
    } else {
      this.layoutService.restoreVerticalAttributes();
    }
    this.layoutService.updateSimpleBar(mode);
    this.autoPersist();
  }

  // ═══════════ Fonts ═══════════

  setFont(type: FontRole, value: string): void {
    // Choosing a font by hand leaves Precision mode.
    this.settings.precisionFont = false;
    switch (type) {
      case 'display': this.settings.displayFont = value; break;
      case 'menu':    this.settings.menuFont = value; break;
      case 'heading': this.settings.headingFont = value; break;
      case 'number':  this.settings.numberFont = value; break;
      case 'other':   this.settings.otherFont = value; break;
    }
    this.applyFontVars();
  }

  /**
   * Writes the five role variables. Every stylesheet in the app reads these (component CSS no longer names a
   * typeface of its own), so a pick here reaches every screen: --font-display for titles, --font-heading for
   * sub-headings and labels, --font-body / --font-other (and the vendor --pe-font-family, --bs-body-font-family,
   * --font-ui) for body copy, --font-number / --font-mono for figures and codes, --font-menu for the sidebar.
   */
  private applyFontVars(): void {
    const s = this.settings;
    const f = (v: string) => (s.precisionFont ? PRECISION_STACK : v);
    this.setCssVar('--font-display', f(s.displayFont));
    this.setCssVar('--font-heading', f(s.headingFont));
    this.setCssVar('--font-menu', f(s.menuFont));
    this.setCssVar('--font-number', f(s.numberFont));
    this.setCssVar('--font-mono', f(s.numberFont));
    for (const v of ['--font-other', '--font-body', '--font-ui', '--pe-font-family', '--bs-body-font-family']) {
      this.setCssVar(v, f(s.otherFont));
    }
  }

  onLineHeightInput(event: Event): void {
    this.settings.lineHeight = parseFloat((event.target as HTMLInputElement).value);
    this.setCssVar('--line-height-base', this.settings.lineHeight.toString());
  }

  getLineHeightLabel(): string {
    if (this.settings.lineHeight <= 1.3) return 'Tight';
    if (this.settings.lineHeight <= 1.8) return 'Normal';
    return 'Loose';
  }

  // ═══════════ Shadow / Radius ═══════════

  onShadowInput(event: Event): void {
    this.settings.shadowStrength = parseInt((event.target as HTMLInputElement).value, 10);
    this.setCssVar('--shadow-strength', (this.settings.shadowStrength / 100).toFixed(2));
  }

  onBorderRadiusInput(event: Event): void {
    this.settings.borderRadius = parseInt((event.target as HTMLInputElement).value, 10);
    this.setCssVar('--radius', `${this.settings.borderRadius}px`);
  }

  onButtonRadiusInput(event: Event): void {
    this.settings.buttonRadius = parseInt((event.target as HTMLInputElement).value, 10);
    this.setCssVar('--btn-radius', `${this.settings.buttonRadius}px`);
  }

  // ═══════════ Sidebar background ═══════════

  selectBg(bg: string | null): void {
    this.settings.sidebarBg = bg;
    this.applySidebarBg(bg);
    this.autoPersist();
  }

  private applySidebarBg(bg: string | null): void {
    // Use the SAME variable name the CSS class `.theme-bg-active` reads,
    // so the dark gradient overlay in sidebar.css sits on top of the image
    // instead of the inline `background-image` overriding it.
    this.setCssVar('--pe-sidebar-bg-image', bg ? `url(${bg})` : 'none');
    // The plain sidebar is painted from --theme-deep in styles/ydot-premium.css; only the image variant needs this.
    const sidebar = this.document.querySelector('.sidebar') as HTMLElement | null;
    if (sidebar) {
      if (bg) {
        sidebar.classList.add('theme-bg-active');
        // Remove the inline background-image so the CSS class gradient overlay
        // (dark overlay) over the image is visible and readable.
        sidebar.style.removeProperty('background-image');
        sidebar.style.backgroundSize = 'cover';
        sidebar.style.backgroundPosition = 'center';
      } else {
        sidebar.classList.remove('theme-bg-active');
        sidebar.style.removeProperty('background-image');
        sidebar.style.removeProperty('background-size');
        sidebar.style.removeProperty('background-position');
        sidebar.style.removeProperty('background-color');
      }
    }
    // Also apply to the pe-app-sidebar element
    const peSidebar = this.document.querySelector('.pe-app-sidebar') as HTMLElement | null;
    if (peSidebar) {
      if (bg) {
        peSidebar.classList.add('theme-bg-active');
        // Same as above — let the CSS class handle the image + dark overlay.
        peSidebar.style.removeProperty('background-image');
        peSidebar.style.backgroundSize = 'cover';
        peSidebar.style.backgroundPosition = 'center';
      } else {
        peSidebar.classList.remove('theme-bg-active');
        peSidebar.style.removeProperty('background-image');
        peSidebar.style.removeProperty('background-size');
        peSidebar.style.removeProperty('background-position');
        peSidebar.style.removeProperty('background-color');
      }
    }
  }

  // ═══════════ Profile photo ═══════════

  selectProfile(url: string): void {
    this.settings.profilePhoto = url;
    this.applyProfilePhoto();
    this.autoPersist();
  }

  /**
   * Paints the picked photo onto the shell's initials badges: --profile-image carries the image,
   * has-profile-photo on <html> is the switch the CSS keys on (styles.css, "Profile photo" — top
   * bar on every page, profile, identifier pages). With no photo both are removed so the badges
   * fall back to initials — which also clears a stale photo when the theme is reset.
   */
  private applyProfilePhoto(): void {
    const root = this.document.documentElement;
    const url = this.settings.profilePhoto;
    if (url) {
      this.setCssVar('--profile-image', `url(${url})`);
      root.classList.add('has-profile-photo');
      this.document.querySelectorAll<HTMLImageElement>('img.profile-avatar, img.user-img').forEach(img => {
        img.src = url;
      });
    } else {
      // DashCase flag: without it removeStyle() does `el.style[name] = ''`, which does not
      // clear a custom property — the old photo then survived resetTheme() (caught by spec).
      this.renderer.removeStyle(root, '--profile-image', 2 /* DashCase, no important */);
      root.classList.remove('has-profile-photo');
    }
  }

  // ═══════════ Custom color persistence ═══════════

  private loadCustomColors(key: string, defaults: string[]): string[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed: string[] = JSON.parse(raw);
      const defaultsLc = defaults.map(c => c.toLowerCase());
      return parsed.filter(c => !defaultsLc.includes(c.toLowerCase()));
    } catch {
      return [];
    }
  }

  private saveCustomColor(key: string, color: string, defaults: string[], presets: string[]): void {
    const lc = color.toLowerCase();
    const defaultsLc = defaults.map(c => c.toLowerCase());
    const presetsLc = presets.map(c => c.toLowerCase());
    if (!defaultsLc.includes(lc) && !presetsLc.includes(lc)) {
      presets.push(color);
      const custom = presets.filter(c => !defaultsLc.includes(c.toLowerCase()));
      try {
        localStorage.setItem(key, JSON.stringify(custom));
      } catch {
        // ignore storage errors
      }
    }
  }

  // ═══════════ Auto persist / apply all ═══════════

  /**
   * Saves the customiser settings. Writes are coalesced into one per microtask: applyAll() and a colour change
   * call setCssVar() (and so this) dozens of times in a row, and each used to serialise and write the whole
   * settings object synchronously.
   */
  private autoPersist(): void {
    if (this.persistQueued) return;
    this.persistQueued = true;
    queueMicrotask(() => {
      this.persistQueued = false;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      } catch {
        // ignore storage errors
      }
    });
  }

  private persistQueued = false;

  private applyAll(): void {
    this.applyLegacyPrimary(this.settings.primaryColor);
    this.setCssVar('--secondary', this.settings.secondaryColor);
    // Apply globally to the app (pe-* variables used by app.min.css)
    this.setCssVar('--pe-secondary', this.settings.secondaryColor);
    this.setCssVar('--pe-secondary-rgb', this.hexToRgb(this.settings.secondaryColor));
    this.setCssVar('--pe-secondary-text-emphasis', this.settings.secondaryColor);
    this.setCssVar('--pe-secondary-bg-subtle', `rgba(${this.hexToRgb(this.settings.secondaryColor)}, 0.1)`);
    this.setCssVar('--pe-secondary-border-subtle', `rgba(${this.hexToRgb(this.settings.secondaryColor)}, 0.5)`);
    this.setCssVar('--pe-secondary-color', this.settings.secondaryColor);
    this.setCssVar('--icon-color', this.settings.iconColor);
    this.setCssVar('--heading-color', this.settings.headingColor);
    this.applyFontVars();
    this.applyTypographyVars();
    this.setCssVar('--line-height-base', this.settings.lineHeight.toString());
    this.setCssVar('--shadow-strength', (this.settings.shadowStrength / 100).toFixed(2));
    this.setCssVar('--radius', `${this.settings.borderRadius}px`);
    this.setCssVar('--btn-radius', `${this.settings.buttonRadius}px`);

    this.applyMode(this.settings.isDarkMode);
    this.layoutService.setAndSaveAttribute(
      'data-layout',
      this.settings.layoutMode === 'fluid' ? 'horizontal' : 'vertical'
    );
    if (this.settings.layoutMode === 'fluid') {
      this.layoutService.removeHorizontalAttributes();
    }

    if (this.settings.sidebarBg) {
      this.applySidebarBg(this.settings.sidebarBg);
    }
    this.applyProfilePhoto();
  }

  // ═══════════ Save / Reset ═══════════

  saveTheme(): void {
    const colors = [this.settings.primaryColor, this.settings.secondaryColor, this.settings.iconColor, this.settings.headingColor];
    if (colors.some(c => !this.isColorAllowed(c))) {
      this.showToast('error', 'Please fix invalid colors before saving.');
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      this.saveCustomColor('custom-secondary-colors', this.settings.secondaryColor, this.defaultSecondaryPresets, this.secondaryPresets);
      this.saveCustomColor('custom-icon-colors',      this.settings.iconColor,      this.defaultIconPresets,      this.iconPresets);
      this.saveCustomColor('custom-heading-colors',   this.settings.headingColor,   this.defaultHeadingPresets,   this.headingPresets);
      this.showToast('success', 'Theme applied successfully.');
      this.closePanel();
    } catch {
      this.showToast('error', 'Could not save theme to this browser.');
    }
  }

  resetTheme(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.settings = { ...DEFAULT_SETTINGS };
    this.themeColorService.resetThemeColor();
    this.applyAll();
    this.renderer.removeStyle(this.document.documentElement, '--pe-sidebar-bg-image');
    this.renderer.removeStyle(this.document.documentElement, '--pe-app-sidebar-bg');
    this.applySidebarBg(null);
    this.showToast('success', 'Theme reset to defaults.');
  }

  /** A saved per-role map, with anything missing or out of range put back to 0 / the nearest limit. */
  private cleanSteps(saved: Partial<RoleLevels> | undefined, min: number, max: number): RoleLevels {
    const out = { ...NO_STEPS };
    for (const role of Object.keys(out) as FontRole[]) {
      const v = Number(saved?.[role]);
      out[role] = Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : 0;
    }
    return out;
  }

  private loadTheme(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        this.settings = { ...DEFAULT_SETTINGS, ...saved };
        // The base size moved up 16% (old 116% is now 100%), so a size saved before that starts again at 100%.
        this.settings.textScale = saved.textScaleV === TEXT_SCALE_VERSION && Number.isFinite(saved.textScale) ? saved.textScale : 1;
        this.settings.textScaleV = TEXT_SCALE_VERSION;
        this.settings.sizeSteps = this.cleanSteps(saved.sizeSteps, SIZE_STEP_MIN, SIZE_STEP_MAX);
        this.settings.weightSteps = this.cleanSteps(saved.weightSteps, WEIGHT_STEP_MIN, WEIGHT_STEP_MAX);
        // One-time move to the Outfit type system: drop fonts saved by older builds, keep the menu font.
        if (saved.fontsV !== FONTS_VERSION) {
          const { displayFont, headingFont, numberFont, otherFont } = DEFAULT_SETTINGS;
          Object.assign(this.settings, { displayFont, headingFont, numberFont, otherFont, fontsV: FONTS_VERSION });
        }
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    // ThemeColorService owns the colour (it also reads the pre-existing customizer value on first run).
    this.settings.primaryColor = this.themeColorService.themeColor();
    this.applyAll();
  }
}