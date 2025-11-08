"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { withBasePath } from "@/lib/utils"

type PoemBookProps = {
	className?: string
}

// Utility to preload images for smoother transitions
function usePreloaded(srcs: string[]) {
	useEffect(() => {
		if (typeof window === "undefined") return
		srcs.forEach((src) => {
			const img = new Image()
			img.src = src
		})
	}, [srcs])
}

export function PoemBook({ className }: PoemBookProps) {
    const pages = useMemo(
        () => [
            withBasePath('/assets/poem/poem_v3/poem_0_text_v3.png'),
            withBasePath('/assets/poem/poem_v3/poem_1_text_v3.png'),
            withBasePath('/assets/poem/poem_v3/poem_2_text_v3.png'),
            withBasePath('/assets/poem/poem_v3/poem_3_text_v3.png'),
            withBasePath('/assets/poem/poem_v3/poem_4_text_v3.png'),
            withBasePath('/assets/poem/poem_v3/poem_5_text_v3.png'),
            withBasePath('/assets/poem/poem_v3/poem_6_text_v3.png'),
            withBasePath('/assets/poem/poem_v3/poem_7_text_v3.png'),
            withBasePath('/assets/poem/poem_v3/poem_8_text_v3.png'),
            withBasePath('/assets/poem/poem_v3/poem_9_text_v3.png'),
            withBasePath('/assets/poem/poem_v3/poem_10_text_v3.png'),
            withBasePath('/assets/poem/poem_v3/poem_11_text_v3.png'),
        ],
        []
    )

    const baseBackground = withBasePath('/assets/poem/empty.jpg')
    usePreloaded([baseBackground, ...pages])

	const [index, setIndex] = useState(0)
	const total = pages.length



	const goNext = () => setIndex((i) => (i + 1) % total)
	const goPrev = () => setIndex((i) => (i - 1 + total) % total)

	return (
		<div
			className={"relative select-none " + (className ?? "")}
		>
			{/* Book Container matches hero portrait container: object-left, contained within max width */}
			<div className="relative w-full overflow-hidden max-w-[clamp(280px,88vw,720px)] min-[769px]:max-w-[clamp(360px,44vw,720px)] lg:max-w-[clamp(420px,40vw,460px)] xl:max-w-[460px]">
				{/* Base image determines container size */}
				<img
					src={baseBackground}
					alt="Poem page base"
					className="w-full h-auto block"
					width={1600}
					height={2000}
					loading="lazy"
					decoding="async"
				/>

				{/* Text overlay */}
				<img
					src={pages[index]}
					alt={`Poem page ${index + 1}`}
					className="absolute left-0 top-[16%] sm:top-[16%] min-[769px]:top-[16%] lg:top-[16%] xl:top-[16%] w-full h-auto object-contain object-left"
					width={1600}
					height={2000}
					loading="lazy"
					decoding="async"
				/>

				{/* Controls - centered at bottom within book container */}
				<div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-4">
					<button
						onClick={goPrev}
						className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition focus:outline-none focus:ring-2 focus:ring-white/60"
						aria-label="Previous page"
					>
						<ChevronLeft size={20} />
					</button>
					<div className="text-[#5a3a2a] font-comfortaa text-sm select-none">
						{index + 1} / {total}
					</div>
					<button
						onClick={goNext}
						className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition focus:outline-none focus:ring-2 focus:ring-white/60"
						aria-label="Next page"
					>
						<ChevronRight size={20} />
					</button>
				</div>
			</div>
			</div>
	)
}

export default PoemBook


