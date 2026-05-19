import { Booklet } from './booklet/Booklet.tsx';
import { sampleDuck } from './voxel/sampleDuck.ts';

export default function App() {
  return <Booklet grid={sampleDuck} setNumber="1986" />;
}
