import { Camera, MapPin, ExternalLink, Calendar, Aperture } from 'lucide-react';
import { useEditorStore } from '@/store';
import {
  formatAperture,
  formatAspectRatio,
  formatCapturedAt,
  formatCoordinates,
  formatExposureBias,
  formatFileSize,
  formatFocalLength,
  formatFormatTag,
  formatIso,
  formatMegapixels,
  formatResolution,
  formatShutter,
  mapsUrlFor,
} from '@/lib/image-metadata';
import { SectionHeader } from './SectionHeader';
import { MetadataMap } from './MetadataMap';
import { MetricChipGrid } from '@/components/ui/MetricChip';
import { MetricChipMenu } from './MetricChipMenu';

/** EXIF + document + file metadata. Each chip group renders only when at
 *  least one of its values is present, and individual chips drop out
 *  silently when their source is missing. The whole section disappears
 *  when nothing at all is available. */
export function MetadataSection() {
  const documentMeta = useEditorStore((s) => s.documentMeta);
  if (!documentMeta) return null;
  const exif = documentMeta.metadata;

  // ─── Camera identity (text, not chips) ────────────────────────────
  const cameraName = exif ? joinNonEmpty([exif.cameraMake, exif.cameraModel]) : undefined;
  const lensModel = exif?.lensModel;

  // ─── Capture chips (EXIF) ─────────────────────────────────────────
  const captureChips: Chip[] = [];
  pushChip(captureChips, 'exif:focal',    'Focal',    formatFocalLength(exif?.focalLengthMm));
  pushChip(captureChips, 'exif:aperture', 'Aperture', formatAperture(exif?.aperture), Aperture);
  pushChip(captureChips, 'exif:shutter',  'Shutter',  formatShutter(exif?.shutterSeconds));
  pushChip(captureChips, 'exif:iso',      'ISO',      formatIso(exif?.iso));
  pushChip(captureChips, 'exif:bias',     'Bias',     formatExposureBias(exif?.exposureBiasEv));

  // ─── Document chips ───────────────────────────────────────────────
  const documentChips: Chip[] = [];
  pushChip(documentChips, 'doc:resolution', 'Resolution', formatResolution(documentMeta.width, documentMeta.height));
  pushChip(documentChips, 'doc:aspect',     'Aspect',     formatAspectRatio(documentMeta.width, documentMeta.height));
  pushChip(documentChips, 'doc:megapixels', 'Pixels',     formatMegapixels(documentMeta.width, documentMeta.height));

  // ─── File chips ───────────────────────────────────────────────────
  const fileChips: Chip[] = [];
  pushChip(fileChips, 'file:format', 'Format', formatFormatTag(documentMeta.mimeType));
  pushChip(fileChips, 'file:size',   'Size',   formatFileSize(documentMeta.fileSize));

  const captureDate = formatCapturedAt(exif?.capturedAt);
  const hasGps = typeof exif?.latitude === 'number' && typeof exif?.longitude === 'number';

  const anyContent =
    cameraName || lensModel ||
    captureChips.length > 0 || documentChips.length > 0 || fileChips.length > 0 ||
    captureDate || hasGps;
  if (!anyContent) return null;

  // Section-level "Pin" pulls every chip across all three groups into one
  // fused info widget. Camera + lens text aren't chip-shaped — we surface
  // them as virtual chips so pinning captures the full picture.
  const sectionPin = [
    ...(cameraName ? [{ id: 'pin-camera', sourceId: 'exif:camera', label: 'Camera', value: cameraName }] : []),
    ...(lensModel  ? [{ id: 'pin-lens',   sourceId: 'exif:lens',   label: 'Lens',   value: lensModel }] : []),
    ...captureChips,  ...documentChips,  ...fileChips,
  ].map((c, i) => ({ id: `pin-${c.sourceId}-${i}`, label: c.label, value: c.value, sourceId: c.sourceId }));

  return (
    <section className="px-3 py-2.5 flex flex-col gap-2.5">
      <SectionHeader icon={Camera} label="Metadata" pinnable={sectionPin} />

      {/* Camera + lens stack — most identifying info first. */}
      {(cameraName || lensModel) && (
        <div className="flex flex-col gap-0.5">
          {cameraName && (
            <div className="text-[11px] text-text-primary font-medium truncate" title={cameraName}>
              {cameraName}
            </div>
          )}
          {lensModel && (
            <div className="text-[10px] text-text-secondary truncate" title={lensModel}>
              {lensModel}
            </div>
          )}
        </div>
      )}

      {/* Capture chip groups. Subhead lines stay subtle so the chips dominate. */}
      <ChipGroup label="Capture"  chips={captureChips} />
      <ChipGroup label="Document" chips={documentChips} />
      <ChipGroup label="File"     chips={fileChips} />

      {/* Date row — small + understated, with an icon as the eye-anchor. */}
      {captureDate && (
        <div className="flex items-center gap-1.5 text-[10px] text-text-secondary">
          <Calendar size={10} className="opacity-70 flex-none" />
          <span className="tabular-nums">{captureDate}</span>
        </div>
      )}

      {/* GPS — embedded Leaflet map + a coordinates row that doubles as
          the "open in OSM" link. Leaflet is dynamically imported, so
          photos without GPS never pay for the dep. */}
      {hasGps && (
        <div className="flex flex-col gap-1.5">
          <MetadataMap latitude={exif!.latitude!} longitude={exif!.longitude!} />
          <a
            href={mapsUrlFor(exif!.latitude!, exif!.longitude!)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[10px] text-text-secondary
              hover:text-text-primary transition-colors"
            title="Open in OpenStreetMap"
          >
            <MapPin size={10} className="flex-none opacity-70" />
            <span className="tabular-nums truncate">
              {formatCoordinates(exif!.latitude!, exif!.longitude!)}
            </span>
            {typeof exif!.altitudeMeters === 'number' && (
              <span className="text-text-secondary/80 tabular-nums">
                · {Math.round(exif!.altitudeMeters)} m
              </span>
            )}
            <ExternalLink size={9} className="ml-auto flex-none opacity-60" aria-hidden />
          </a>
        </div>
      )}
    </section>
  );
}

// ─── Internals ─────────────────────────────────────────────────────────

type Chip = {
  /** Stable source id used by the chip menu's "Pin" + "Ask AI" actions
   *  so a pinned/attached chip remembers where it came from. */
  sourceId: string;
  label: string;
  value: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
};

/** Group of chips under a tiny subheader. Renders nothing when empty so the
 *  surrounding section's flex-gap doesn't collapse onto a void. */
function ChipGroup({ label, chips }: { label: string; chips: Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[8px] uppercase tracking-wide text-text-secondary/80">{label}</div>
      <MetricChipGrid>
        {chips.map((c) => (
          <MetricChipMenu
            key={c.sourceId}
            sourceId={c.sourceId}
            label={c.label}
            value={c.value}
            icon={c.icon}
          />
        ))}
      </MetricChipGrid>
    </div>
  );
}

function pushChip(
  list: Chip[], sourceId: string, label: string, value: string | undefined,
  icon?: Chip['icon'],
): void {
  if (!value) return;
  list.push({ sourceId, label, value, icon });
}

function joinNonEmpty(parts: (string | undefined)[]): string | undefined {
  const filtered = parts.filter((p): p is string => !!p && p.length > 0);
  if (filtered.length === 0) return undefined;
  return filtered.join(' ');
}
