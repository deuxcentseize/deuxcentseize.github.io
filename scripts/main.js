document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('recent-list');
  if (!list) return; // only on home page

  fetch('data/posts.json')
    .then(resp => resp.json())
    .then(items => {
      items.sort((a,b) => new Date(b.date) - new Date(a.date));
      const recent = items.slice(0,5);
      recent.forEach(item => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="${item.url}">${item.title}</a> <small>(${item.type})</small>`;
        list.appendChild(li);
      });
    })
    .catch(err => {
      console.error('Could not load posts.json', err);
      list.innerHTML = '<li>No recent posts yet.</li>';
    });
});
