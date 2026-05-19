import { Booklet } from './booklet/Booklet.tsx';
import { Gallery } from './booklet/Gallery.tsx';
import { sampleDuck } from './voxel/sampleDuck.ts';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('gallery')) {
    return <Gallery />;
  }
  return <Booklet grid={sampleDuck} setNumber="1986" />;
}
