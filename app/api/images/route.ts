import { NextResponse } from 'next/server'
import path from 'path'
import { promises as fs } from 'fs'

function isImageFile(name: string): boolean {
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(name)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const folder = searchParams.get('folder')?.trim()

  if (!folder) {
    return NextResponse.json({ images: [] }, { status: 400 })
  }

  const baseDir = path.join(process.cwd(), 'public', 'assets', folder)
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true })
    const images = entries
      .filter((e) => e.isFile() && isImageFile(e.name))
      .map((e) => `/assets/${folder}/${e.name}`)
      .sort((a, b) => a.localeCompare(b))

    return NextResponse.json({ images })
  } catch {
    return NextResponse.json({ images: [] }, { status: 404 })
  }
}


