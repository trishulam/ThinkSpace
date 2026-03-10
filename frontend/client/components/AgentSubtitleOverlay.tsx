import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AgentSubtitleState } from '../types/agent-live'

interface AgentSubtitleOverlayProps {
	subtitle: AgentSubtitleState
}

export function AgentSubtitleOverlay({ subtitle }: AgentSubtitleOverlayProps) {
	const isActive = subtitle.isVisible && subtitle.revealedText.trim().length > 0
	const [visibleText, setVisibleText] = useState(subtitle.revealedText)
	const measureRef = useRef<HTMLDivElement | null>(null)
	const tokenRefs = useRef<Array<HTMLSpanElement | null>>([])
	const tokens = useMemo(
		() => subtitle.revealedText.match(/\S+\s*|\s+/g) ?? [],
		[subtitle.revealedText]
	)

	const updateVisibleWindow = useCallback(() => {
		if (!isActive) {
			setVisibleText('')
			return
		}

		const spans = tokenRefs.current.filter(Boolean) as HTMLSpanElement[]
		if (spans.length === 0) {
			setVisibleText(subtitle.revealedText)
			return
		}

		const lines: string[] = []
		let currentTop = spans[0].offsetTop
		let currentLine = ''

		for (const span of spans) {
			const token = span.dataset.token ?? span.textContent ?? ''
			if (span.offsetTop !== currentTop) {
				lines.push(currentLine)
				currentLine = ''
				currentTop = span.offsetTop
			}
			currentLine += token
		}

		if (currentLine) {
			lines.push(currentLine)
		}

		const normalizedLines = lines
			.map((line) => line.replace(/\s+$/g, ''))
			.filter((line) => line.length > 0)
		const nextText =
			normalizedLines.length <= 4
				? normalizedLines.join('\n')
				: normalizedLines.slice(-4).join('\n')

		setVisibleText(nextText || subtitle.revealedText)
	}, [isActive, subtitle.revealedText])

	useLayoutEffect(() => {
		updateVisibleWindow()
	}, [updateVisibleWindow])

	useEffect(() => {
		if (!isActive || !measureRef.current || typeof ResizeObserver === 'undefined') {
			return
		}

		const observer = new ResizeObserver(() => {
			updateVisibleWindow()
		})
		observer.observe(measureRef.current)

		return () => {
			observer.disconnect()
		}
	}, [isActive, updateVisibleWindow])

	return (
		<div
			className={`agent-subtitle-overlay${isActive ? ' visible' : ''}`}
			aria-hidden={!isActive}
		>
			<div
				className={`agent-subtitle-chip status-${subtitle.status}${subtitle.isPartial ? ' partial' : ''}`}
				role="status"
				aria-live="polite"
			>
				{visibleText}
			</div>
			{isActive ? (
				<div
					ref={measureRef}
					className="agent-subtitle-chip agent-subtitle-measure"
					aria-hidden="true"
				>
					{tokens.map((token, index) => (
						<span
							key={`${index}-${token}`}
							ref={(element) => {
								tokenRefs.current[index] = element
							}}
							data-token={token}
						>
							{token}
						</span>
					))}
				</div>
			) : null}
		</div>
	)
}
