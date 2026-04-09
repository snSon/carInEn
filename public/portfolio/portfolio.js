document.addEventListener('DOMContentLoaded', () => {
    // 1. 메인 캐러셀 데이터 로드 (JSON)
    loadMainCarousel();

    // 2. 스크롤 애니메이션 옵저버 등록
    initScrollAnimations();
});

// --- [기능 1] Main Carousel JSON 로드 ---
async function loadMainCarousel() {
    const indicatorsContainer = document.getElementById('carouselIndicators');
    const innerContainer = document.getElementById('carouselInner');
    // 실제 이미지가 있는 폴더 경로 (현재는 예시 경로)
    const imagePath = './images/main_carousel_images/'; 

    try {
        const response = await fetch('./main_data.json');
        if (!response.ok) throw new Error("JSON 로드 실패");
        const slides = await response.json();

        let indicatorsHtml = '';
        let slidesHtml = '';

        slides.forEach((slide, index) => {
            const activeClass = index === 0 ? 'active' : '';
            
            // Indicator
            indicatorsHtml += `<button type="button" data-bs-target="#mainCarousel" data-bs-slide-to="${index}" class="${activeClass}" aria-label="Slide ${index + 1}"></button>`;
            
            // Slide Item (이미지가 없다면 Picsum 랜덤 이미지로 대체하는 로직 포함)
            // 실제 사용 시: src="${imagePath}${slide.filename}"
            const imgSrc = slide.filename.startsWith('http') ? slide.filename : `${imagePath}${slide.filename}`;
            
            slidesHtml += `
                <div class="carousel-item ${activeClass}" data-bs-interval="5000">
                    <img src="${imgSrc}" class="d-block w-100" alt="${slide.title}">
                    <div class="carousel-caption d-none d-md-block">
                        <h5>${slide.title}</h5>
                        <p>${slide.description}</p>
                    </div>
                </div>`;
        });

        indicatorsContainer.innerHTML = indicatorsHtml;
        innerContainer.innerHTML = slidesHtml;

    } catch (error) {
        console.error("Carousel Error:", error);
        // 에러 시 기본 이미지 표시 (옵션)
        innerContainer.innerHTML = `<div class="p-5 text-center text-danger">데이터를 불러오지 못했습니다.</div>`;
    }
}

// --- [기능 2] Intersection Observer (스크롤 애니메이션) ---
function initScrollAnimations() {
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.3
    };

    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            const target = entry.target;

            // [화면에 보일 때 (isIntersecting: true)]
            if (entry.isIntersecting) {
                
                // 1. Skill Card
                if (target.classList.contains('skill-card')) {
                    target.classList.remove('opacity-0', 'translate-y-20');
                    target.style.transition = 'all 0.6s ease-out';
                    
                    const progressBar = target.querySelector('.progress-bar');
                    if (progressBar) {
                        const width = progressBar.getAttribute('data-width');
                        setTimeout(() => { progressBar.style.width = width; }, 300);
                    }
                    observer.unobserve(target); // 스킬 카드는 한 번만 실행하고 끝냄
                }

                // 2. Stack Table
                if (target.tagName === 'TR') {
                    target.classList.remove('opacity-0', 'translate-x-minus-20');
                    target.style.transition = 'all 0.5s ease-out';
                    observer.unobserve(target); // 테이블도 한 번만 실행하고 끝냄
                }

                // [수정됨] 3. Closing 섹션 (반복 실행을 위해 unobserve 제거)
                if (target.id === 'section-closing') {
                    // 배경 애니메이션 클래스 추가
                    target.classList.add('flash-animation');

                    // 카드 애니메이션 클래스 추가
                    const card = target.querySelector('.card');
                    if (card) {
                        card.classList.add('pop-animation');
                    }
                    
                    // 주의: Closing 섹션은 반복 실행을 위해 여기서 observer.unobserve(target)을 하지 않음!
                }

            } else {
                // [화면에서 사라질 때 (isIntersecting: false)]
                // Closing 섹션이 화면 밖으로 나가면 클래스를 제거해두어야, 다시 들어올 때 애니메이션이 됩니다.
                
                if (target.id === 'section-closing') {
                    target.classList.remove('flash-animation');
                    const card = target.querySelector('.card');
                    if (card) {
                        card.classList.remove('pop-animation');
                    }
                }
            }
        });
    }, observerOptions);

    // 관찰 대상 등록
    document.querySelectorAll('.skill-card').forEach(card => observer.observe(card));
    document.querySelectorAll('#stackTableBody tr').forEach(row => {
        const index = Array.from(row.parentNode.children).indexOf(row);
        row.style.transitionDelay = `${index * 0.1}s`;
        observer.observe(row);
    });
    
    const closingSection = document.getElementById('section-closing');
    if (closingSection) {
        observer.observe(closingSection);
    }
}