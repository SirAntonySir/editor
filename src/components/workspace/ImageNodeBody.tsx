interface ImageNodeBodyProps {
  imageNodeId: string;
  layerIds: string[];
  width: number;
  height: number;
}

export function ImageNodeBody({ width, height }: ImageNodeBodyProps) {
  return (
    <div
      aria-label="Image node body"
      className="bg-surface-secondary border border-separator"
      style={{ width, height }}
    />
  );
}
