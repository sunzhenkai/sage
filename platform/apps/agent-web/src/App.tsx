import { Button } from '@/components/ui/button'

function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-2xl font-semibold tracking-tight">agent-web</h1>
      <p className="text-sm text-muted-foreground">Sage workspace control plane</p>
      <Button type="button">Get started</Button>
    </main>
  )
}

export default App
