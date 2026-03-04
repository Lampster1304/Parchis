// Native fetch in Node 18+

async function test() {
    try {
        const res = await fetch('http://localhost:3000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@example.com' })
        });
        console.log('Status:', res.status);
        const text = await res.text();
        console.log('Body snippet:', text.substring(0, 100));
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
